import {DontRetry, JobRejected, sendJob} from '../../../platform/background';
import type {PrismaClient} from '../../../platform/db';
import type {ExportKind, ExportStatus} from '../../../lib/intelform/api-exports';
import {buildPart, type BuildContext, type BuildState} from './builders';
import {ExportError} from './errors';

export {ExportError};

/**
 * Exports run in the `intelform-exports` background job (docs/agent/background-jobs.md), never
 * in a request: a big CSV or ZIP is CPU and many queries, and a Worker request has neither the
 * CPU nor the time. One run builds bounded batches for up to RUN_BUDGET_MS, appends what it
 * built to the export as one more part (`intelform_export_parts`) and saves its progress in the
 * same statement, then sends the next run. A run that repeats (at-least-once) or retries starts
 * from the saved progress: a part is written exactly once (its seq is the parts count it saw).
 * When the file is complete the export is `ready`; the dashboard downloads it
 * (GET /site-api/exports/:id/download streams the parts, no CPU work) and the hourly maintenance
 * sweeps exports a day old.
 */

export const EXPORTS_LIST = 'intelform-exports';
/** Time one run builds for (a run has 60 s; the rest is the write and the next send). */
const RUN_BUDGET_MS = 30_000;
/** A part is written when the built bytes pass this (bounded memory per run). */
const PART_BYTES = 768 * 1024;
/** A file past this stops with a message (stays well inside a Worker's memory and the ZIP limit). */
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
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
    SELECT id::text AS id, user_id, kind, form_id::text AS form_id, params, status, state, rows, bytes, parts,
      file_name, content_type, error, created_at, updated_at
    FROM intelform_exports WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

/** Sends one run of an export. Throws JobRejected when the platform refuses it. */
export async function sendExportRun(requestUrl: string, id: string, step: number): Promise<void> {
  await sendJob(requestUrl, EXPORTS_LIST, {exportId: id}, {key: `export-${id}-${step}`, label: `Export, part ${step + 1}`});
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
      WHERE status = 'running' AND updated_at < now() - make_interval(mins => ${STALE_MINUTES}::int)
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

  const ctx: BuildContext = {db: db as PrismaClient, kind: row.kind, formId: row.form_id, params: row.params};
  let state: BuildState = row.state ?? {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  let rows = 0;
  let done = false;
  try {
    while (!done && size < PART_BYTES && now() - started < RUN_BUDGET_MS) {
      const part = await buildPart(ctx, state);
      if (part.bytes.length) {
        chunks.push(part.bytes);
        size += part.bytes.length;
      }
      rows += part.rows;
      state = part.state;
      done = part.done;
    }
  } catch (err) {
    if (err instanceof ExportError) {
      await fail(db, id, err.message);
      return;
    }
    throw err; // tried again later, from the saved progress
  }

  const total = Number(row.bytes) + size;
  if (total > MAX_EXPORT_BYTES) {
    await fail(db, id, 'This export is too large for one file. Narrow it with filters, or export fewer forms.');
    return;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }

  // ONE statement: the part (seq = the parts count this run saw) and the progress. A run that
  // repeats finds the part there (ON CONFLICT) and the parts count moved: it changes nothing.
  // An export that stopped meanwhile (failed: responses in it were deleted, or it went stale)
  // gets no part.
  const saved = await db.$queryRaw<{id: string}[]>`
    WITH p AS (
      INSERT INTO intelform_export_parts (export_id, seq, data)
      SELECT ${id}::uuid, ${row.parts}::int, ${bytes}
      WHERE ${size}::int > 0
        AND EXISTS (SELECT 1 FROM intelform_exports WHERE id = ${id}::uuid AND status = 'running' AND parts = ${row.parts}::int)
      ON CONFLICT (export_id, seq) DO NOTHING
      RETURNING 1
    )
    UPDATE intelform_exports SET
      state = ${JSON.stringify(done ? {} : state)}::jsonb,
      rows = rows + ${rows}::int,
      bytes = bytes + ${size}::bigint,
      parts = parts + (SELECT count(*)::int FROM p),
      status = ${done ? 'ready' : 'running'},
      updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND parts = ${row.parts}::int
      AND (${size}::int = 0 OR EXISTS (SELECT 1 FROM p))
    RETURNING id::text AS id
  `;
  if (!saved.length) {
    // Stopped while this run built (a delete committed while this statement ran): no part of a
    // stopped export stays behind.
    await db.$executeRaw`
      DELETE FROM intelform_export_parts p USING intelform_exports e
      WHERE p.export_id = e.id AND e.id = ${id}::uuid AND e.status <> 'running'
    `;
    return;
  }
  if (done) return;

  try {
    await (deps.send ?? sendExportRun)(requestUrl, id, row.parts + 1);
  } catch (err) {
    // Refused (busy): this run is tried again later and carries on from what it saved.
    if (err instanceof JobRejected) throw new Error(`The next part of the export wasn’t queued (${err.code}).`);
    throw err;
  }
}

/** Exports started more than KEEP_HOURS ago go (their parts with them). */
export async function sweepExports(db: Db): Promise<number> {
  return db.$executeRaw`
    DELETE FROM intelform_exports WHERE id IN (
      SELECT id FROM intelform_exports WHERE created_at < now() - make_interval(hours => ${KEEP_HOURS}::int) LIMIT 500
    )
  `;
}
