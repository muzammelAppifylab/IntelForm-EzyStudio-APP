import {DontRetry, JobRejected, sendJob} from '../../../platform/background';
import type {PrismaClient} from '../../../platform/db';
import type {ExportKind, ExportStatus} from '../../../lib/intelform/api-exports';
import {buildPart, closeFile, MAX_EXPORT_BYTES, openFile, type BuildContext, type BuildState} from './builders';
import {platformStore, type ExportFileStore} from './storage';
import {ExportError} from './errors';

export {ExportError, MAX_EXPORT_BYTES};

/**
 * Exports run in the `intelform-exports` background job (docs/agent/background-jobs.md), never
 * in a request: a big CSV or ZIP is CPU and many queries, and a Worker request has neither the
 * CPU nor the time. ONE run builds ONE file: bounded batches until it holds PART_ROWS rows or
 * PART_BYTES bytes, or the export is done. Its size is capped by rows and bytes built, never by
 * the clock (a deployed Worker's clock does not move during CPU work, so a time budget never
 * fires there). The file goes to the platform's file storage (private: exports/storage.ts, the
 * server's own createUpload, PUT and completeUpload); `intelform_export_parts` keeps its id,
 * never its bytes, and the progress is saved in the same statement that marks it stored. Then the
 * run sends the next one. A run that repeats (at-least-once) or retries starts from the saved
 * progress: a file is kept exactly once (its seq is the parts count it saw), and a file a stopped
 * run left behind is replaced and goes to the file trash.
 *
 * A big export is several files, each complete on its own (builders.ts `openFile`/`closeFile`).
 * A refused send (the site's jobs-per-minute limit, the platform busy) never fails the export:
 * it is marked `send_pending` and the 15-minute job sends it again (`resendPendingExports`).
 * When the last file is stored the export is `ready`; the dashboard asks for its files
 * (GET /site-api/exports/:id/files: the owner and permission checks, then 5-minute links) and
 * the hourly maintenance sweeps exports a day old. A deleted part (the sweep, a failed export, a
 * deleted form) puts its stored file in intelform_file_trash (a trigger), and the file cleanup
 * removes it from storage.
 */

export const EXPORTS_LIST = 'intelform-exports';
/** Rows one run (one file) holds at most. */
export const PART_ROWS = 50_000;
/** Bytes one run (one file) holds at most: the run's memory is about this, once. */
export const PART_BYTES = 16 * 1024 * 1024;
/** An export whose next run couldn't be queued for this long has stopped (it is marked failed). */
export const PENDING_SEND_MINUTES = 120;
/** Exports the 15-minute job sends again per run (each send counts toward the jobs-per-minute limit). */
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

export function statusOf(
  row: Pick<ExportRow, 'id' | 'kind' | 'status' | 'rows' | 'file_name' | 'error' | 'created_at'> & {parts?: number}
): ExportStatus {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    rows: Number(row.rows),
    files: row.status === 'ready' ? Number(row.parts ?? 0) : 0,
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
 * The next run wasn't queued: the 15-minute job sends it (`resendPendingExports`). Also for
 * the start route when its first send is refused (`runs` 0).
 */
export async function markSendPending(db: Db, id: string, runs: number): Promise<void> {
  await db.$executeRaw`
    UPDATE intelform_exports SET send_pending = true, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND runs = ${runs}::int
  `;
}

/**
 * The 15-minute job: sends again the runs of exports whose send was refused (oldest first,
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

export interface ExportJobDeps {
  send?: typeof sendExportRun;
  lastTry?: boolean;
  /** Where the files go (tests: a stand-in; default the platform's storage). */
  store?: ExportFileStore;
  /** Tests: smaller files. */
  partRows?: number;
  partBytes?: number;
}

/**
 * The job handler: `{exportId}`. `lastTry` (the platform's last attempt): a run that fails then
 * marks the export failed, so it never shows "running" with nothing left to run it.
 */
export async function runExportJob(db: Db, requestUrl: string, data: unknown, deps: ExportJobDeps = {}): Promise<void> {
  const id = String((data as {exportId?: unknown} | null)?.exportId ?? '');
  if (!UUID.test(id)) throw new DontRetry('This export job has no export id.');
  try {
    await runExport(db, requestUrl, id, deps);
  } catch (err) {
    if (deps.lastTry || err instanceof DontRetry) await fail(db, id, UNFINISHED).catch(() => undefined);
    throw err;
  }
}

/** The stored file's name: the export's own when it is one file, else "<name> part <n>". */
export function partName(fileName: string, seq: number, only: boolean): string {
  if (only) return fileName;
  const dot = fileName.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
  return `${base} part ${seq + 1}${ext}`;
}

/** The storage's type for an export's Content-Type (`text/csv; charset=utf-8` is a CSV). */
const storedType = (contentType: string) => (contentType.startsWith('application/zip') ? 'application/zip' : 'text/csv');

async function runExport(db: Db, requestUrl: string, id: string, deps: ExportJobDeps): Promise<void> {
  const row = await loadExport(db, id);
  // Gone (its form was deleted, swept) or already finished: nothing to do.
  if (!row || row.status !== 'running') return;

  const seq = Number(row.parts);
  const written = Number(row.bytes);
  const ctx: BuildContext = {db: db as PrismaClient, kind: row.kind, formId: row.form_id, params: row.params, written};
  let state: BuildState = row.state ?? {};
  let done = false;
  let empty = false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let rows = 0;
  try {
    // A later file starts with its own header; written once the file gets content of its own.
    let head: Uint8Array | null = null;
    if (seq > 0) {
      const opened = await openFile(ctx, state);
      head = opened.head.length ? opened.head : null;
      state = opened.state;
    }
    // ONE file: until it holds PART_ROWS rows or PART_BYTES bytes, or the export is done.
    const maxBytes = deps.partBytes ?? PART_BYTES;
    const maxRows = deps.partRows ?? PART_ROWS;
    while (!done && size < maxBytes && rows < maxRows) {
      ctx.written = written + size;
      ctx.rowsLeft = maxRows - rows;
      const part = await buildPart(ctx, state);
      if (part.bytes.length) {
        if (head) {
          chunks.push(head);
          size += head.length;
          head = null;
        }
        chunks.push(part.bytes);
        size += part.bytes.length;
      }
      rows += part.rows;
      state = part.state;
      done = part.done;
      empty = !!part.empty;
      if (written + size > MAX_EXPORT_BYTES) throw new ExportError(TOO_LARGE);
    }
    if (!done) {
      const closed = closeFile(ctx, state);
      if (closed.tail.length) {
        chunks.push(closed.tail);
        size += closed.tail.length;
      }
      state = closed.state;
    }
  } catch (err) {
    if (err instanceof ExportError) {
      await fail(db, id, err.message);
      return;
    }
    throw err; // tried again later, from the saved progress
  }

  // An export that ended exactly where the last file did: nothing more to keep.
  const keep = size > 0 && !(done && empty && seq > 0);
  if (keep) {
    const stored = await storeFile(db, deps.store ?? platformStore(requestUrl), row, seq, chunks, size, done);
    chunks.length = 0;
    if (stored === 'failed' || stored === 'gone') return;
  }
  const saved = await saveProgress(db, id, {seq, kept: keep, size, rows, state: done ? {} : state, done});
  if (!saved || done) return;

  const step = Number(row.runs) + 1;
  try {
    await (deps.send ?? sendExportRun)(requestUrl, id, step);
  } catch (err) {
    // Refused (busy, the jobs-per-minute limit) or unreachable: never a failed export. The
    // 15-minute job sends it (resendPendingExports).
    console.warn(`[intelform] next export run not queued (${err instanceof JobRejected ? err.code : err instanceof Error ? err.name : 'error'})`);
    await markSendPending(db, id, step);
  }
}

/**
 * Stores one file: the upload grant first, its id written as part `seq` (not ready) only while
 * the export still runs at this seq, so a file never exists without a row that leads the sweep
 * to it; then the bytes and the platform's check, then the row is ready. A repeat run replaces a
 * part that never got ready (its file goes to the trash, a trigger); a ready one is kept and this
 * run's file removed. 'stored' | 'gone' (the export stopped, or another run stored it) |
 * 'failed' (storage can't take it: the export failed with words for people). Throws to retry.
 */
async function storeFile(
  db: Db,
  store: ExportFileStore,
  row: ExportRow,
  seq: number,
  chunks: Uint8Array[],
  size: number,
  done: boolean
): Promise<'stored' | 'gone' | 'failed'> {
  const name = partName(row.file_name, seq, done && seq === 0);
  const begun = await store.begin(name, storedType(row.content_type), size);
  if (!begun.ok) {
    if (begun.retry) throw new Error(`Storage refused the export file (${begun.code}).`);
    await fail(db, row.id, begun.message);
    return 'failed';
  }
  const claimed = await db.$queryRaw<{seq: number}[]>`
    INSERT INTO intelform_export_parts AS p (export_id, seq, file_id, size)
    SELECT ${row.id}::uuid, ${seq}::int, ${begun.fileId}, ${size}::int
    WHERE EXISTS (SELECT 1 FROM intelform_exports WHERE id = ${row.id}::uuid AND status = 'running' AND parts = ${seq}::int)
    ON CONFLICT (export_id, seq) DO UPDATE SET file_id = EXCLUDED.file_id, size = EXCLUDED.size, ready = false, created_at = now()
      WHERE NOT p.ready
    RETURNING seq
  `;
  if (!claimed.length) {
    await store.remove(begun.fileId);
    return 'gone';
  }
  const finished = await store.finish(begun.fileId, begun.upload, new Blob(chunks as BlobPart[]));
  if (!finished.ok) {
    if (finished.retry) throw new Error(`The export file was not stored (${finished.code}).`);
    await fail(db, row.id, finished.message);
    return 'failed';
  }
  const ready = await db.$executeRaw`
    UPDATE intelform_export_parts SET ready = true
    WHERE export_id = ${row.id}::uuid AND seq = ${seq}::int AND file_id = ${begun.fileId}
  `;
  return ready ? 'stored' : 'gone';
}

/**
 * ONE statement: the progress after a file (seq = the parts count this run saw). Only while the
 * export runs at this seq and, when a file was kept, its part is ready with that seq: a run that
 * repeats finds the parts count moved and changes nothing. False when nothing was saved.
 */
async function saveProgress(
  db: Db,
  id: string,
  p: {seq: number; kept: boolean; size: number; rows: number; state: BuildState; done: boolean}
): Promise<boolean> {
  const saved = await db.$queryRaw<{id: string}[]>`
    UPDATE intelform_exports SET
      state = ${JSON.stringify(p.state)}::jsonb,
      rows = rows + ${p.rows}::int,
      bytes = bytes + ${p.kept ? p.size : 0}::bigint,
      parts = parts + ${p.kept ? 1 : 0}::int,
      runs = runs + 1,
      send_pending = false,
      status = ${p.done ? 'ready' : 'running'},
      updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND parts = ${p.seq}::int
      AND (NOT ${p.kept}::boolean OR EXISTS (
        SELECT 1 FROM intelform_export_parts WHERE export_id = ${id}::uuid AND seq = ${p.seq}::int AND ready))
    RETURNING id::text AS id
  `;
  return saved.length > 0;
}

/** The stored files of a ready export, in order (the route checks who asks first). */
export async function exportFiles(db: Db, id: string): Promise<{seq: number; file_id: string; size: number}[]> {
  return db.$queryRaw<{seq: number; file_id: string; size: number}[]>`
    SELECT seq, file_id, size FROM intelform_export_parts WHERE export_id = ${id}::uuid AND ready ORDER BY seq LIMIT 1000
  `;
}

/** Exports started more than KEEP_HOURS ago go (their parts with them). */
export async function sweepExports(db: Db): Promise<number> {
  return db.$executeRaw`
    DELETE FROM intelform_exports WHERE id IN (
      SELECT id FROM intelform_exports WHERE created_at < now() - make_interval(hours => ${KEEP_HOURS}::int) LIMIT 500
    )
  `;
}
