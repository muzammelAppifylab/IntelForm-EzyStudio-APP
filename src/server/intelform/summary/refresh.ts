import {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import {loadCatalog} from '../responses/catalog';
import {getAppSettings} from '../settings/settings';
import {fieldClasses, summaryZone} from './math';

/**
 * Keeps form_summary_days up to date, OFF the submit path (the every-minute job calls
 * `refreshSummaryRollups`). Per form, responses are added up in (submitted_at, id) order from
 * the form's watermark, a bounded batch per statement, so a form with a million responses is
 * backfilled from its oldest response over a few runs and then only adds what came in since.
 *
 * - Only responses older than LAG are added: a submit commits within milliseconds of its
 *   submitted_at, so nothing can appear behind the watermark later. Newer ones are read live by
 *   the Summary (src/server/intelform/summary/read.ts).
 * - Days are in the APP's time zone (Settings → General). When it changes, the form starts a new
 *   generation from scratch and the old rows are deleted a batch at a time.
 * - Each batch locks the rows it reads (FOR SHARE) and moves the watermark in the same
 *   statement; the delete trigger subtracts only rows inside the watermark. Two runs never add
 *   the same rows: the state row is taken FOR UPDATE SKIP LOCKED.
 * - Funnel events (form_event_counts, 15-minute buckets in 16 shards) are folded into days too,
 *   up to a bucket that can no longer change.
 */

const sql = Prisma.sql;

/** Responses newer than this are left to the live read. */
const LAG = "interval '2 minutes'";
/** Forms looked at per run (least recently refreshed first). */
const FORMS_PER_RUN = 25;
/** Answer values (responses × fields) per batch statement: about a second of work. */
const VALUES_PER_BATCH = 300_000;
const MIN_BATCH = 50;
const MAX_BATCH = 2_000;
/** Old-generation rows deleted per statement. */
const GARBAGE_BATCH = 20_000;
/** Event days folded per statement. */
const EVENT_SPAN = "interval '60 days'";

export interface RefreshResult {
  /** Responses added up by this run. */
  rows: number;
  /** Work is left: call again soon. */
  more: boolean;
}

interface FormTodo {
  id: string;
  pv: string | null;
  tz: string | null;
  gen: number | null;
  fv: string | null;
  fields_set: boolean | null;
  fields_n: number | null;
}

/** The rows a batch takes for a form with `fieldCount` fields. */
export function batchSize(fieldCount: number): number {
  return Math.max(MIN_BATCH, Math.min(MAX_BATCH, Math.floor(VALUES_PER_BATCH / Math.max(fieldCount, 1))));
}

/**
 * One run: up to `budgetMs` of work (a step already started may finish a little after it).
 * Signature kept stable for the every-minute job (src/server/background.ts).
 */
export async function refreshSummaryRollups(db: PrismaClient, opts: {budgetMs: number}): Promise<RefreshResult> {
  const started = Date.now();
  const left = () => opts.budgetMs - (Date.now() - started);
  const tz = summaryZone((await getAppSettings(db)).timezone);
  const todo = await db.$queryRaw<FormTodo[]>`
    SELECT f.id::text AS id, f.published_version_id::text AS pv, s.tz, s.gen, s.fields_version::text AS fv,
      (s.fields <> '{}'::jsonb) AS fields_set,
      coalesce(jsonb_array_length(s.fields->'all'), 0)::int AS fields_n
    FROM forms f LEFT JOIN form_summary_state s ON s.form_id = f.id
    WHERE s.form_id IS NULL OR s.tz <> ${tz}
      OR EXISTS (SELECT 1 FROM responses r WHERE r.form_id = f.id
        AND r.submitted_at >= coalesce(s.wm_at, '-infinity'::timestamptz) AND r.submitted_at < now() - ${Prisma.raw(LAG)}
        AND (s.wm_at IS NULL OR r.submitted_at > s.wm_at OR r.id > s.wm_id))
      OR EXISTS (SELECT 1 FROM form_event_counts e WHERE e.form_id = f.id
        AND e.bucket >= coalesce(s.ev_wm, '-infinity'::timestamptz) AND e.bucket < ${eventCutoff()})
      OR EXISTS (SELECT 1 FROM form_summary_days d WHERE d.form_id = f.id AND d.gen < s.gen)
    ORDER BY s.updated_at ASC NULLS FIRST, f.id
    LIMIT ${FORMS_PER_RUN}
  `;
  let rows = 0;
  let more = todo.length === FORMS_PER_RUN;
  // Round robin: one step per form in turn, so one big backfill never starves the others.
  const queue = todo.map(f => ({...f, events: true}));
  while (queue.length) {
    if (left() <= 0) {
      more = true;
      break;
    }
    const form = queue.shift()!;
    const step = await stepForm(db, form, tz);
    rows += step.rows;
    if (step.more) queue.push({...form, ...step.state, events: false});
  }
  return {rows, more};
}

/** The first 15-minute bucket that may still change (event rows are written with now()). */
function eventCutoff(): Prisma.Sql {
  return sql`date_bin('15 minutes', now() - interval '20 minutes', '2000-01-01'::timestamptz)`;
}

type StepState = Pick<FormTodo, 'tz' | 'gen' | 'fv' | 'fields_set' | 'fields_n'>;

async function stepForm(db: PrismaClient, form: FormTodo & {events: boolean}, tz: string): Promise<{rows: number; more: boolean; state: StepState}> {
  const state: StepState = {tz: form.tz, gen: form.gen, fv: form.fv, fields_set: form.fields_set, fields_n: form.fields_n};
  // New form, or the app's time zone changed: a new generation, from the first response.
  if (state.gen === null || state.tz !== tz) {
    const [s] = await db.$queryRaw<{gen: number}[]>`
      INSERT INTO form_summary_state AS s (form_id, tz) VALUES (${form.id}::uuid, ${tz})
      ON CONFLICT (form_id) DO UPDATE SET tz = EXCLUDED.tz, gen = s.gen + 1, wm_at = NULL, wm_id = NULL, ev_wm = NULL,
        updated_at = now()
      WHERE s.tz <> EXCLUDED.tz
      RETURNING gen
    `;
    if (!s) return {rows: 0, more: false, state};
    state.gen = s.gen;
    state.tz = tz;
  }
  const gen = state.gen!;

  // Rows of an older generation, a batch at a time.
  const garbage = await db.$executeRaw`
    DELETE FROM form_summary_days WHERE ctid = ANY(ARRAY(
      SELECT ctid FROM form_summary_days WHERE form_id = ${form.id}::uuid AND gen < ${gen} LIMIT ${GARBAGE_BATCH}))
  `;
  if (garbage >= GARBAGE_BATCH) return {rows: 0, more: true, state};

  // The field classes, from the catalog of the published version (every version's fields).
  if (!state.fields_set || state.fv !== form.pv) {
    const cat = await loadCatalog(db, form.id);
    if (!cat) return {rows: 0, more: false, state};
    const classes = fieldClasses(cat);
    const fields = {...classes, all: cat.entries.map(e => e.meta.id)};
    await db.$executeRaw`
      UPDATE form_summary_state SET fields = ${JSON.stringify(fields)}::jsonb, fields_version = ${cat.form.publishedVersionId}::uuid
      WHERE form_id = ${form.id}::uuid AND gen = ${gen}
    `;
    state.fv = cat.form.publishedVersionId;
    state.fields_set = true;
    state.fields_n = fields.all.length;
  }

  // One batch of responses. Skipped if the form was published again since the classes were read
  // (the next run reads them again) or another run holds the form.
  const size = batchSize(state.fields_n ?? 0);
  const [batch] = await db.$queryRaw<{n: number}[]>`
    WITH st AS (
      SELECT gen, tz, wm_at, wm_id, fields, fields_version FROM form_summary_state
      WHERE form_id = ${form.id}::uuid AND gen = ${gen} FOR UPDATE SKIP LOCKED
    ),
    b AS (
      SELECT r.id, r.submitted_at, r.answers, r.ttc, r.duration_ms FROM responses r, st
      WHERE r.form_id = ${form.id}::uuid AND r.submitted_at < now() - ${Prisma.raw(LAG)}
        AND r.submitted_at >= coalesce(st.wm_at, '-infinity'::timestamptz)
        AND (st.wm_at IS NULL OR r.submitted_at > st.wm_at OR r.id > st.wm_id)
        AND EXISTS (SELECT 1 FROM forms fo WHERE fo.id = ${form.id}::uuid AND fo.published_version_id IS NOT DISTINCT FROM st.fields_version)
      ORDER BY r.submitted_at, r.id
      LIMIT ${size}
      FOR SHARE OF r
    ),
    agg AS (
      SELECT count(*)::int AS n,
        array_agg((b.submitted_at AT TIME ZONE st.tz)::date) AS days, array_agg(b.answers) AS answers,
        array_agg(b.ttc) AS ttc, array_agg(b.duration_ms) AS dur,
        max(b.submitted_at) AS last_at,
        (array_agg(b.id ORDER BY b.submitted_at DESC, b.id DESC))[1] AS last_id
      FROM b, st GROUP BY st.gen
    ),
    applied AS (
      SELECT form_summary_apply(${form.id}::uuid, st.gen, 1, agg.days, agg.answers, agg.ttc, agg.dur, st.fields) AS touched
      FROM agg, st
    ),
    moved AS (
      UPDATE form_summary_state s SET wm_at = agg.last_at, wm_id = agg.last_id, updated_at = now()
      FROM agg WHERE s.form_id = ${form.id}::uuid AND (SELECT count(*) FROM applied) > 0
      RETURNING 1
    )
    SELECT coalesce((SELECT n FROM agg), 0)::int AS n, (SELECT count(*) FROM moved)::int AS moved
  `;
  const rows = Number(batch?.n ?? 0);
  let more = rows >= size;

  // Funnel events, once per run per form, at most EVENT_SPAN of days per statement.
  if (form.events) {
    const [ev] = await db.$queryRaw<{moved: number; behind: boolean}[]>`
      WITH st AS (
        SELECT gen, tz, ev_wm FROM form_summary_state WHERE form_id = ${form.id}::uuid AND gen = ${gen} FOR UPDATE SKIP LOCKED
      ),
      lim AS (
        SELECT st.gen, st.tz, st.ev_wm, ${eventCutoff()} AS cutoff,
          least(${eventCutoff()}, coalesce(st.ev_wm, (SELECT min(bucket) FROM form_event_counts WHERE form_id = ${form.id}::uuid)) + ${Prisma.raw(EVENT_SPAN)}) AS hi
        FROM st
      ),
      src AS (
        SELECT (e.bucket AT TIME ZONE lim.tz)::date AS day, sum(e.views)::bigint AS views, sum(e.starts)::bigint AS starts
        FROM form_event_counts e, lim
        WHERE e.form_id = ${form.id}::uuid AND e.bucket >= coalesce(lim.ev_wm, '-infinity'::timestamptz) AND e.bucket < lim.hi
        GROUP BY 1
      ),
      ins AS (
        INSERT INTO form_summary_days AS d (form_id, gen, grain, day, field_id, kind, key, n, s)
        SELECT ${form.id}::uuid, lim.gen, g.grain, CASE WHEN g.grain = 'M' THEN date_trunc('month', src.day)::date ELSE src.day END,
          '', 'e', k.key, sum(CASE WHEN k.key = 'v' THEN src.views ELSE src.starts END)::int, NULL
        FROM src, lim, (VALUES ('D'), ('M')) g(grain), (VALUES ('v'), ('s')) k(key)
        GROUP BY 2, 3, 4, 7
        ORDER BY 3, 4, 7
        ON CONFLICT (form_id, gen, grain, day, field_id, kind, key) DO UPDATE SET n = d.n + EXCLUDED.n
        RETURNING 1
      ),
      moved AS (
        UPDATE form_summary_state s SET ev_wm = lim.hi FROM lim
        WHERE s.form_id = ${form.id}::uuid AND lim.hi IS NOT NULL AND (SELECT count(*) FROM ins) >= 0
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM moved)::int AS moved, coalesce((SELECT hi < cutoff FROM lim), false) AS behind
    `;
    if (ev?.behind) more = true;
  }
  return {rows, more, state};
}
