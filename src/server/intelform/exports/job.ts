import {DontRetry, JobRejected, sendJob} from '../../../platform/background';
import type {PrismaClient} from '../../../platform/db';
import type {ExportKind, ExportStatus} from '../../../lib/intelform/api-exports';
import {buildPart, MAX_EXPORT_BYTES, type BuildContext, type BuildState} from './builders';
import {ExportError} from './errors';

export {ExportError, MAX_EXPORT_BYTES};

/**
 * Exports run in the `intelform-exports` background job (docs/agent/background-jobs.md), never
 * in a request: a big CSV or ZIP is CPU and many queries, and a Worker request has neither the
 * CPU nor the time. One run builds bounded batches for up to RUN_BUDGET_MS; each time what it
 * built passes PART_BYTES it appends it to the export as one more part (`intelform_export_parts`)
 * and saves its progress in the same statement, so a run fills its time budget (about 30 s, a
 * few parts) and memory stays at about one part. Then it sends the next run. A run that repeats
 * (at-least-once) or retries starts from the saved progress: a part is written exactly once (its
 * seq is the parts count it saw).
 *
 * A refused send (the site's jobs-per-minute limit, the platform busy) never fails the export:
 * it is marked `send_pending` and the every-minute job sends it again (`resendPendingExports`).
 * When the file is complete the export is `ready`; the dashboard downloads it
 * (GET /site-api/exports/:id/download streams the parts, no CPU work) and the hourly maintenance
 * sweeps exports a day old.
 */

export const EXPORTS_LIST = 'intelform-exports';
/** Time one run builds for (a run has 60 s; the rest is the write and the next send). */
const RUN_BUDGET_MS = 30_000;
/** A part is written when the built bytes pass this (bounded memory: about one part per run). */
export const PART_BYTES = 8 * 1024 * 1024;
/** An export whose next run couldn't be queued for this long has stopped (it is marked failed). */
export const PENDING_SEND_MINUTES = 120;
/** Exports the every-minute job sends again per run (each send counts toward the jobs-per-minute limit). */
const RESEND_PER_MINUTE = 3;
const TOO_LARGE = 'This export is too large for one file. Narrow it with filters, or export fewer forms.';
/** Exports are kept this long (hours) after they are started. */
export const KEEP_HOURS = 24;
/**
 * A running export with no progress saved for this long has stopped: its job ran out of tries
 * (1 + 2 + 10 minutes of retry delays, each run up to 1 minute) or was lost. It is marked failed
 * so the dashboard says "didn't finish, try again" instead of "running" until the sweep.
 */
export const STALE_MINUTES = 20;
/** What a person sees for an export that stopped. */
export const UNFINISHED = 'The export didn’t finish. Try again.';

export interface ExportRow {
  id: string;
  user_id: number;
  kind: ExportKind;
  form_id: string | null;
  params: Record<string, unknown>;
  status: 'running' | 'ready' | 'failed';
  state: BuildState;
  rows: number;
  bytes: string | number | bigint;
  parts: number;
  runs: number;
  file_name: string;
  content_type: string;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export function statusOf(row: Pick<ExportRow, 'id' | 'kind' | 'status' | 'rows' | 'file_name' | 'error' | 'created_at'>): ExportStatus {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    rows: Number(row.rows),
    fileName: row.file_name,
    error: row.status === 'failed' ? (row.error ?? UNFINISHED) : null,
    createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  };
}

type Db = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export async function loadExport(db: Db, id: string): Promise<ExportRow | null> {
  const rows = await db.$queryRaw<ExportRow[]>`
    SELECT id::text AS id, user_id, kind, form_id::text AS form_id, params, status, state, rows, bytes, parts, runs,
      file_name, content_type, error, created_at, updated_at
    FROM intelform_exports WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

/** Sends run `step` of an export (0 the first). Throws JobRejected when the platform refuses it. */
export async function sendExportRun(requestUrl: string, id: string, step: number): Promise<void> {
  await sendJob(requestUrl, EXPORTS_LIST, {exportId: id}, {key: `export-${id}-${step}`, label: `Export, part ${step + 1}`});
}

/**
 * The next run wasn't queued: the every-minute job sends it (`resendPendingExports`). Also for
 * the start route when its first send is refused (`runs` 0).
 */
export async function markSendPending(db: Db, id: string, runs: number): Promise<void> {
  await db.$executeRaw`
    UPDATE intelform_exports SET send_pending = true, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND runs = ${runs}::int
  `;
}

/**
 * The every-minute job: sends again the runs of exports whose send was refused (oldest first,
 * RESEND_PER_MINUTE a minute; a refusal stops until next minute). The job key is the run's
 * number, so a send that did reach the platform before is not run twice. Returns how many went.
 */
export async function resendPendingExports(db: Db, requestUrl: string, deps: {send?: typeof sendExportRun} = {}): Promise<number> {
  const pending = await db.$queryRaw<{id: string; runs: number}[]>`
    SELECT id::text AS id, runs FROM intelform_exports
    WHERE status = 'running' AND send_pending
    ORDER BY updated_at
    LIMIT ${RESEND_PER_MINUTE}
  `;
  let sent = 0;
  for (const p of pending) {
    try {
      await (deps.send ?? sendExportRun)(requestUrl, p.id, p.runs);
    } catch (err) {
      if (err instanceof JobRejected) break; // still busy: next minute
      console.warn(`[intelform] export run not re-sent (${err instanceof Error ? err.name : 'error'})`);
      continue;
    }
    sent++;
    await db.$executeRaw`
      UPDATE intelform_exports SET send_pending = false, updated_at = now()
      WHERE id = ${p.id}::uuid AND runs = ${p.runs}::int AND send_pending
    `;
  }
  return sent;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fail(db: Db, id: string, message: string): Promise<void> {
  await db.$executeRaw`
    UPDATE intelform_exports SET status = 'failed', error = ${message.slice(0, 300)}, state = '{}'::jsonb, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running'
  `;
  await db.$executeRaw`DELETE FROM intelform_export_parts WHERE export_id = ${id}::uuid`;
}

/**
 * Marks running exports with no progress for STALE_MINUTES failed (their parts go): one export
 * (`id`, the status route) or up to 500 (the hourly maintenance). Returns how many.
 */
export async function failStaleExports(db: Db, id?: string): Promise<number> {
  const only = id ?? null;
  const stale = await db.$queryRaw<{id: string}[]>`
    UPDATE intelform_exports SET status = 'failed', error = ${UNFINISHED}, state = '{}'::jsonb, updated_at = now()
    WHERE id IN (
      SELECT id FROM intelform_exports
      WHERE status = 'running'
        AND updated_at < now() - make_interval(mins => CASE WHEN send_pending THEN ${PENDING_SEND_MINUTES}::int ELSE ${STALE_MINUTES}::int END)
        AND (${only}::uuid IS NULL OR id = ${only}::uuid)
      LIMIT 500
    ) AND status = 'running'
    RETURNING id::text AS id
  `;
  if (stale.length) {
    await db.$executeRaw`DELETE FROM intelform_export_parts WHERE export_id = ANY(${stale.map(s => s.id)}::uuid[])`;
  }
  return stale.length;
}

/**
 * The job handler: `{exportId}`. `lastTry` (the platform's last attempt): a run that fails then
 * marks the export failed, so it never shows "running" with nothing left to run it.
 */
export async function runExportJob(
  db: Db,
  requestUrl: string,
  data: unknown,
  deps: {now?: () => number; send?: typeof sendExportRun; lastTry?: boolean} = {}
): Promise<void> {
  const id = String((data as {exportId?: unknown} | null)?.exportId ?? '');
  if (!UUID.test(id)) throw new DontRetry('This export job has no export id.');
  try {
    await runExport(db, requestUrl, id, deps);
  } catch (err) {
    if (deps.lastTry || err instanceof DontRetry) await fail(db, id, UNFINISHED).catch(() => undefined);
    throw err;
  }
}

async function runExport(
  db: Db,
  requestUrl: string,
  id: string,
  deps: {now?: () => number; send?: typeof sendExportRun}
): Promise<void> {
  const now = deps.now ?? Date.now;
  const started = now();
  const row = await loadExport(db, id);
  // Gone (its form was deleted, swept) or already finished: nothing to do.
  if (!row || row.status !== 'running') return;

  let parts = Number(row.parts);
  let written = Number(row.bytes);
  const ctx: BuildContext = {db: db as PrismaClient, kind: row.kind, formId: row.form_id, params: row.params, written};
  let state: BuildState = row.state ?? {};
  let done = false;
  for (;;) {
    // Build one part: until it passes PART_BYTES, the run's time is up or the file is done.
    const chunks: Uint8Array[] = [];
    let size = 0;
    let rows = 0;
    try {
      while (!done && size < PART_BYTES && now() - started < RUN_BUDGET_MS) {
        ctx.written = written + size;
        const part = await buildPart(ctx, state);
        if (part.bytes.length) {
          chunks.push(part.bytes);
          size += part.bytes.length;
        }
        rows += part.rows;
        state = part.state;
        done = part.done;
        if (written + size > MAX_EXPORT_BYTES) throw new ExportError(TOO_LARGE);
      }
    } catch (err) {
      if (err instanceof ExportError) {
        await fail(db, id, err.message);
        return;
      }
      throw err; // tried again later, from the saved progress
    }
    const last = done || size < PART_BYTES || now() - started >= RUN_BUDGET_MS;
    const saved = await savePart(db, id, {parts, chunks, size, rows, state: done ? {} : state, done, endRun: last});
    if (!saved) return;
    if (size > 0) parts++;
    written += size;
    if (last) break;
  }
  if (done) return;

  const step = Number(row.runs) + 1;
  try {
    await (deps.send ?? sendExportRun)(requestUrl, id, step);
  } catch (err) {
    // Refused (busy, the jobs-per-minute limit) or unreachable: never a failed export. The
    // every-minute job sends it (resendPendingExports).
    console.warn(`[intelform] next export run not queued (${err instanceof JobRejected ? err.code : err instanceof Error ? err.name : 'error'})`);
    await markSendPending(db, id, step);
  }
}

/**
 * ONE statement: the part (seq = the parts count this run saw) and the progress. A run that
 * repeats finds the part there (ON CONFLICT) and the parts count moved: it changes nothing. An
 * export that stopped meanwhile (failed: responses in it were deleted, or it went stale) gets no
 * part. `endRun` counts the run (the next run's job key). False when nothing was saved.
 */
async function savePart(
  db: Db,
  id: string,
  p: {parts: number; chunks: Uint8Array[]; size: number; rows: number; state: BuildState; done: boolean; endRun: boolean}
): Promise<boolean> {
  const bytes = new Uint8Array(p.size);
  let at = 0;
  for (const c of p.chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  p.chunks.length = 0;
  const saved = await db.$queryRaw<{id: string}[]>`
    WITH p AS (
      INSERT INTO intelform_export_parts (export_id, seq, data)
      SELECT ${id}::uuid, ${p.parts}::int, ${bytes}
      WHERE ${p.size}::int > 0
        AND EXISTS (SELECT 1 FROM intelform_exports WHERE id = ${id}::uuid AND status = 'running' AND parts = ${p.parts}::int)
      ON CONFLICT (export_id, seq) DO NOTHING
      RETURNING 1
    )
    UPDATE intelform_exports SET
      state = ${JSON.stringify(p.state)}::jsonb,
      rows = rows + ${p.rows}::int,
      bytes = bytes + ${p.size}::bigint,
      parts = parts + (SELECT count(*)::int FROM p),
      runs = runs + ${p.endRun ? 1 : 0}::int,
      send_pending = false,
      status = ${p.done ? 'ready' : 'running'},
      updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND parts = ${p.parts}::int
      AND (${p.size}::int = 0 OR EXISTS (SELECT 1 FROM p))
    RETURNING id::text AS id
  `;
  if (saved.length) return true;
  // Stopped while this run built (a delete committed while this statement ran): no part of a
  // stopped export stays behind.
  await db.$executeRaw`
    DELETE FROM intelform_export_parts p USING intelform_exports e
    WHERE p.export_id = e.id AND e.id = ${id}::uuid AND e.status <> 'running'
  `;
  return false;
}

/** Exports started more than KEEP_HOURS ago go (their parts with them). */
export async function sweepExports(db: Db): Promise<number> {
  return db.$executeRaw`
    DELETE FROM intelform_exports WHERE id IN (
      SELECT id FROM intelform_exports WHERE created_at < now() - make_interval(hours => ${KEEP_HOURS}::int) LIMIT 500
    )
  `;
}
