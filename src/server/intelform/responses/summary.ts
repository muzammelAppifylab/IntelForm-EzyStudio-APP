import {
  MAX_SUMMARY_DAYS,
  daySpan,
  type ChoiceSummaryOption,
  type LatestAnswer,
  type QuestionData,
  type QuestionSummary,
  type SummaryQuery,
  type SummaryResponse,
} from '../../../lib/intelform/api-responses';
import {OTHER_OPTION_ID} from '../../../lib/intelform/form/definition';
import type {FieldType} from '../../../lib/intelform/form/field-types';
import {countryName} from '../../../lib/intelform/form/types/registry';
import {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import {cache} from '../../../platform/cache';
import type {CatalogEntry, FormCatalog} from './catalog';
import {displayAnswer} from './format';
import {addDays, rangeFragment, safeTz, todayIn} from './query';

/**
 * GET /site-api/responses/forms/:id/summary: per-question aggregates, the funnel and the daily
 * series. Every aggregate is ONE set-based query over the form's responses in range (never a
 * query per question); they are all plain reads sent together in one `Promise.all`, so the
 * whole summary is one round trip (two for "All time", which first reads the first day).
 * Labels, "(deleted option)" and percentages are added here.
 */

const sql = Prisma.sql;

const COUNTED = new Set<FieldType>([
  'single_choice',
  'dropdown',
  'multiple_choice',
  'picture_choice',
  'yes_no',
  'country',
  'rating',
  'nps',
]);
const NUMERIC = new Set<FieldType>(['number', 'rating', 'nps']);
const LATEST = new Set<FieldType>(['email', 'name', 'phone', 'address', 'short_text', 'long_text', 'url', 'date', 'time']);

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class SummaryRangeError extends Error {}

/** The local-date range [from, to] of a summary request. `firstDay` is the form's first response day, for "all". */
export function summaryRange(q: SummaryQuery, today: string, firstDay: string | null): {from: string; to: string} {
  if (q.range === 'custom') {
    const from = q.from!;
    const to = q.to!;
    // The schema checks this too; the daily series is one row per day, so check again here.
    if (daySpan(from, to) + 1 > MAX_SUMMARY_DAYS) throw new SummaryRangeError('Pick a range of ten years or less.');
    return {from, to};
  }
  if (q.range === 'all')
    return {
      from: firstDay && firstDay < today ? firstDay : addDays(today, -6),
      to: today,
    };
  return {
    from: addDays(today, -(Number.parseInt(q.range, 10) - 1)),
    to: today,
  };
}

type LatestRow = {
  field_id: string;
  id: string;
  submitted_at: Date;
  val: unknown;
};
type NumbersRow = {
  field_id: string;
  n: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
};

/**
 * Site Cache (docs/agent/cache.md):
 *   report:summary:<formId>:<range>:<from>:<to>:<tz>   5 min   the Summary tab (aggregates over
 *   every response in range). The same for every RESPONSE_READ viewer of the form. Cleared with
 *   `clearSummaryCache` when responses are deleted (one, a selection, a contact erase, retention)
 *   and on publish (the questions changed); a new response just shows within 5 minutes.
 */
const SUMMARY_PREFIX = 'report:summary:';
const SUMMARY_TTL = 5 * 60;
const KEY_SAFE = /^[A-Za-z0-9_./:-]{0,64}$/;

/**
 * formSummary through the cache (a key from ids, the range and the zone only). Only the
 * aggregates are cached: the latest text answers and "Other" answers are what respondents typed
 * (names, emails…), never put in the cache, so they are read fresh beside it (two LIMIT 10 reads).
 */
export async function cachedFormSummary(db: PrismaClient, cat: FormCatalog, q: SummaryQuery): Promise<SummaryResponse> {
  const tz = safeTz(q.tz);
  const parts = [q.range, q.from ?? '', q.to ?? '', tz];
  if (!parts.every(p => KEY_SAFE.test(p))) return formSummary(db, cat, q);
  const agg = await cache.getOrSet(`${SUMMARY_PREFIX}${cat.form.id}:${parts.join(':')}`, SUMMARY_TTL, () =>
    formSummary(db, cat, q, {answers: false})
  );
  const [latest, others] = await answerQueries(db, cat, sql`form_id = ${cat.form.id}::uuid AND ${rangeFragment(agg.range.from, agg.range.to, agg.range.tz)}`);
  return withAnswers(agg, cat, latest, others);
}

/** Puts the latest and "Other" answers into a summary built without them. */
export function withAnswers(s: SummaryResponse, cat: FormCatalog, latest: LatestRow[], others: LatestRow[]): SummaryResponse {
  const latestBy = groupByField(latest);
  const othersBy = groupByField(others);
  return {
    ...s,
    questions: s.questions.map(question => {
      const e = cat.byId.get(question.fieldId);
      if (!e) return question;
      if (question.data.kind === 'latest') return {...question, data: {kind: 'latest', items: latestItems(e, latestBy.get(e.meta.id) ?? [])}};
      if (question.data.kind === 'choice' && othersBy.has(e.meta.id)) {
        return {...question, data: {...question.data, other: otherItems(othersBy.get(e.meta.id) ?? [])}};
      }
      return question;
    }),
  };
}

function groupByField<T extends {field_id: string}>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.field_id, [...(m.get(r.field_id) ?? []), r]);
  return m;
}

/** The 10 latest answers per text-like question, and per choice question with "Other", in range. */
function answerQueries(db: PrismaClient, cat: FormCatalog, inForm: Prisma.Sql): Promise<[LatestRow[], LatestRow[]]> {
  const latestIds = cat.entries.filter(e => LATEST.has(e.meta.type)).map(e => e.meta.id);
  const otherIds = cat.entries
    .filter(e => ['single_choice', 'multiple_choice'].includes(e.meta.type) && e.meta.options?.some(o => o.id === OTHER_OPTION_ID))
    .map(e => e.meta.id);
  const latestQ = latestIds.length
    ? db.$queryRaw<LatestRow[]>`
        SELECT f.id AS field_id, t.* FROM unnest(${latestIds}::text[]) f(id) CROSS JOIN LATERAL (
          SELECT id, submitted_at, answers->f.id AS val FROM responses
          WHERE ${inForm} AND answers ? f.id
          ORDER BY submitted_at DESC, id DESC LIMIT 10) t
      `
    : Promise.resolve([] as LatestRow[]);
  const othersQ = otherIds.length
    ? db.$queryRaw<LatestRow[]>`
        SELECT f.id AS field_id, t.* FROM unnest(${otherIds}::text[]) f(id) CROSS JOIN LATERAL (
          SELECT id, submitted_at, answers->f.id AS val FROM responses
          WHERE ${inForm}
            AND (answers @> jsonb_build_object(f.id, jsonb_build_object('option', ${OTHER_OPTION_ID}::text))
              OR answers @> jsonb_build_object(f.id, jsonb_build_array(jsonb_build_object('option', ${OTHER_OPTION_ID}::text))))
          ORDER BY submitted_at DESC, id DESC LIMIT 10) t
      `
    : Promise.resolve([] as LatestRow[]);
  return Promise.all([latestQ, othersQ]);
}

/** After responses of a form (or, without an id, of any form) were deleted, or it was published. */
export async function clearSummaryCache(formId?: string): Promise<void> {
  await cache.delPrefix(formId ? `${SUMMARY_PREFIX}${formId}:` : SUMMARY_PREFIX);
}

export async function formSummary(
  db: PrismaClient,
  cat: FormCatalog,
  q: SummaryQuery,
  opts: {answers?: boolean} = {}
): Promise<SummaryResponse> {
  const formId = cat.form.id;
  const tz = safeTz(q.tz);
  const today = todayIn(tz);
  let firstDay: string | null = null;
  if (q.range === 'all') {
    const [first] = await db.$queryRaw<{day: string | null}[]>`
      SELECT to_char(min(submitted_at) AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day FROM responses WHERE form_id = ${formId}::uuid
    `;
    firstDay = first?.day ?? null;
  }
  const {from, to} = summaryRange(q, today, firstDay);
  const range = rangeFragment(from, to, tz);
  const ids = (pred: (t: FieldType) => boolean) => cat.entries.filter(e => pred(e.meta.type)).map(e => e.meta.id);
  const countedIds = ids(t => COUNTED.has(t));
  const numericIds = ids(t => NUMERIC.has(t));
  const inForm = sql`form_id = ${formId}::uuid AND ${range}`;

  const topQ = db.$queryRaw<{responses: number; avg_ms: number | null; median_ms: number | null}[]>`
    SELECT count(*)::int AS responses, (avg(duration_ms) FILTER (WHERE duration_ms < 86400000))::float8 AS avg_ms,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::float8 AS median_ms
    FROM responses WHERE ${inForm}
  `;
  const seriesQ = db.$queryRaw<{day: string; n: number}[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(c.n, 0)::int AS n
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
    LEFT JOIN (SELECT (submitted_at AT TIME ZONE ${tz})::date AS day, count(*) n
               FROM responses WHERE ${inForm} GROUP BY 1) c ON c.day = d::date
    ORDER BY d
  `;
  const choicesQ = countedIds.length
    ? db.$queryRaw<{field_id: string; option_id: string | null; n: number}[]>`
        SELECT f.id AS field_id, c->>'option' AS option_id, count(*)::int AS n
        FROM responses r CROSS JOIN unnest(${countedIds}::text[]) f(id)
        CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(r.answers->f.id)
           WHEN 'array' THEN r.answers->f.id WHEN 'object' THEN jsonb_build_array(r.answers->f.id)
           ELSE jsonb_build_array(jsonb_build_object('option', r.answers->f.id)) END) c
        WHERE r.form_id = ${formId}::uuid AND ${range} AND r.answers ? f.id GROUP BY 1, 2
      `
    : Promise.resolve([]);
  const answeredQ = db.$queryRaw<{field_id: string; answered: number}[]>`
    SELECT k AS field_id, count(*)::int AS answered FROM responses r CROSS JOIN LATERAL jsonb_object_keys(r.answers) k
    WHERE r.form_id = ${formId}::uuid AND ${range} GROUP BY 1
  `;
  const numbersQ = numericIds.length
    ? db.$queryRaw<NumbersRow[]>`
        SELECT e.key AS field_id, count(*)::int AS n, avg(e.value::numeric)::float8 AS avg, min(e.value::numeric)::float8 AS min,
          max(e.value::numeric)::float8 AS max, (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric))::float8 AS median
        FROM responses r CROSS JOIN LATERAL jsonb_each(r.answers) e
        WHERE r.form_id = ${formId}::uuid AND ${range} AND e.key = ANY(${numericIds}::text[])
          AND jsonb_typeof(e.value) = 'number'
        GROUP BY 1
      `
    : Promise.resolve([]);
  const personalQ = opts.answers === false ? Promise.resolve([[], []] as [LatestRow[], LatestRow[]]) : answerQueries(db, cat, inForm);
  const funnelQ = db.$queryRaw<{views: number; starts: number}[]>`
    SELECT coalesce(sum(views), 0)::int AS views, coalesce(sum(starts), 0)::int AS starts FROM form_event_counts
    WHERE form_id = ${formId}::uuid AND bucket >= (${from}::date::timestamp AT TIME ZONE ${tz})
      AND bucket < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})
  `;
  const ttcQ = db.$queryRaw<{field_id: string; median: number}[]>`
    SELECT e.key AS field_id, (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric))::float8 AS median
    FROM responses r CROSS JOIN LATERAL jsonb_each(r.ttc) e
    WHERE r.form_id = ${formId}::uuid AND ${range} AND r.ttc IS NOT NULL AND jsonb_typeof(r.ttc) = 'object'
      AND jsonb_typeof(e.value) = 'number'
    GROUP BY 1
  `;
  const [top, series, choices, answered, numbers, [latest, others], funnel, ttc] = await Promise.all([
    topQ,
    seriesQ,
    choicesQ,
    answeredQ,
    numbersQ,
    personalQ,
    funnelQ,
    ttcQ,
  ]);

  const answeredBy = new Map(answered.map(r => [r.field_id, Number(r.answered)]));
  const countsBy = new Map<string, Map<string, number>>();
  for (const r of choices) {
    if (r.option_id === null) continue;
    const m = countsBy.get(r.field_id) ?? new Map<string, number>();
    m.set(r.option_id, (m.get(r.option_id) ?? 0) + Number(r.n));
    countsBy.set(r.field_id, m);
  }
  const numbersBy = new Map(numbers.map(r => [r.field_id, r]));
  const ttcBy = new Map(ttc.map(r => [r.field_id, Number(r.median)]));
  const group = <T extends {field_id: string}>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.field_id, [...(m.get(r.field_id) ?? []), r]);
    return m;
  };
  const latestBy = group(latest);
  const othersBy = group(others);

  const questions: QuestionSummary[] = [];
  for (const e of cat.entries) {
    const n = answeredBy.get(e.meta.id) ?? 0;
    // Deleted questions only appear while answers to them are in range.
    if (e.meta.deleted && n === 0) continue;
    const data = questionData(
      e,
      n,
      countsBy.get(e.meta.id) ?? new Map(),
      numbersBy.get(e.meta.id),
      latestBy.get(e.meta.id) ?? [],
      othersBy.get(e.meta.id) ?? []
    );
    questions.push({
      fieldId: e.meta.id,
      type: e.meta.type,
      label: e.meta.label,
      deleted: e.meta.deleted,
      answered: n,
      medianTimeMs: ttcBy.has(e.meta.id) ? Math.round(ttcBy.get(e.meta.id)!) : null,
      data,
    });
  }

  const t = top[0] ?? {responses: 0, avg_ms: null, median_ms: null};
  const views = Number(funnel[0]?.views ?? 0);
  const starts = Number(funnel[0]?.starts ?? 0);
  const responses = Number(t.responses);
  return {
    range: {preset: q.range, from, to, tz},
    totals: {
      views,
      starts,
      responses,
      completionRate: starts > 0 ? Math.min(responses / starts, 1) : null,
      avgMs: t.avg_ms === null ? null : Math.round(Number(t.avg_ms)),
      medianMs: t.median_ms === null ? null : Math.round(Number(t.median_ms)),
    },
    series: series.map(r => ({day: r.day, count: Number(r.n)})),
    questions,
    formTotal: cat.form.responseCount,
  };
}

const pct = (count: number, of: number) => (of > 0 ? round1((count / of) * 100) : 0);

function latestItems(e: CatalogEntry, rows: {id: string; submitted_at: Date; val: unknown}[]): LatestAnswer[] {
  return rows
    .map(r => ({
      responseId: r.id,
      submittedAt: r.submitted_at.toISOString(),
      text: displayAnswer(e.display, r.val).text,
    }))
    .filter(r => r.text !== '');
}

function otherItems(rows: {id: string; submitted_at: Date; val: unknown}[]) {
  return rows
    .map(r => ({
      responseId: r.id,
      submittedAt: (r.submitted_at instanceof Date ? r.submitted_at : new Date(r.submitted_at)).toISOString(),
      text: otherText(r.val),
    }))
    .filter(r => r.text !== '');
}

function otherText(val: unknown): string {
  const list = Array.isArray(val) ? val : [val];
  for (const x of list) {
    if (x && typeof x === 'object' && (x as {option?: unknown}).option === OTHER_OPTION_ID) {
      const t = (x as {other?: unknown}).other;
      return typeof t === 'string' ? t : '';
    }
  }
  return '';
}

/** Per-type card data. Exported for unit tests. */
export function questionData(
  e: CatalogEntry,
  answered: number,
  counts: Map<string, number>,
  numbers:
    | {
        n: number;
        avg: number | null;
        min: number | null;
        max: number | null;
        median: number | null;
      }
    | undefined,
  latest: {id: string; submitted_at: Date; val: unknown}[],
  others: {id: string; submitted_at: Date; val: unknown}[]
): QuestionData {
  const type = e.meta.type;
  switch (type) {
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
    case 'picture_choice':
    case 'yes_no': {
      const options: ChoiceSummaryOption[] = [];
      for (const o of e.meta.options ?? []) {
        const count = counts.get(o.id) ?? 0;
        // Deleted options only while they have answers.
        if (o.deleted && count === 0) continue;
        options.push({
          id: o.id,
          label: o.label,
          count,
          pct: pct(count, answered),
          ...(o.deleted && {deleted: true}),
          ...(o.id === OTHER_OPTION_ID && {other: true}),
        });
      }
      // Answers whose option is in no version (shouldn't happen): keep them countable.
      for (const [id, count] of counts) {
        if (!options.some(o => o.id === id)) {
          options.push({
            id,
            label: id === OTHER_OPTION_ID ? 'Other' : `${id} (deleted option)`,
            count,
            pct: pct(count, answered),
            deleted: id !== OTHER_OPTION_ID,
            ...(id === OTHER_OPTION_ID && {other: true}),
          });
        }
      }
      return {kind: 'choice', options, other: otherItems(others)};
    }
    case 'country': {
      const options = [...counts]
        .map(([id, count]) => ({
          id,
          label: countryName(id),
          count,
          pct: pct(count, answered),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return {kind: 'choice', options, other: []};
    }
    case 'rating': {
      const scale = (e.display.props as {scale?: number}).scale ?? 5;
      const distribution = Array.from({length: scale}, (_, i) => ({
        value: i + 1,
        count: counts.get(String(i + 1)) ?? 0,
      }));
      const total = distribution.reduce((s, d) => s + d.count, 0);
      const satisfied = distribution.filter(d => d.value >= 4).reduce((s, d) => s + d.count, 0);
      return {
        kind: 'rating',
        scale,
        average: numbers?.avg == null ? null : round1(Number(numbers.avg)),
        distribution,
        // CSAT: share of 4 and 5 on a 5-point scale.
        csat: scale === 5 && total > 0 ? round1((satisfied / total) * 100) : null,
      };
    }
    case 'nps': {
      const distribution = Array.from({length: 11}, (_, i) => ({
        value: i,
        count: counts.get(String(i)) ?? 0,
      }));
      const sum = (lo: number, hi: number) => distribution.filter(d => d.value >= lo && d.value <= hi).reduce((s, d) => s + d.count, 0);
      const detractors = sum(0, 6);
      const passives = sum(7, 8);
      const promoters = sum(9, 10);
      const total = detractors + passives + promoters;
      // Same rounding as the dashboard's npsScore (Math.round), so card and score agree.
      const score = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
      return {
        kind: 'nps',
        score,
        detractors,
        passives,
        promoters,
        distribution,
      };
    }
    case 'number':
      return {
        kind: 'number',
        average: numbers?.avg == null ? null : round1(Number(numbers.avg)),
        min: num(numbers?.min),
        max: num(numbers?.max),
        median: numbers?.median == null ? null : round1(Number(numbers.median)),
      };
    case 'signature':
      return {kind: 'count', count: answered, noun: 'signed'};
    case 'consent':
      return {kind: 'count', count: answered, noun: 'accepted'};
    default:
      return {kind: 'latest', items: latestItems(e, latest)};
  }
}
