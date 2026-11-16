import {JobRejected, sendJob} from '../../../platform/background';
import type {PrismaClient} from '../../../platform/db';
import {deleteFile} from '../../../platform/files';

/**
 * Stored files of deleted responses (signatures). A trigger on `responses` puts the file id of
 * every signature answer into `intelform_file_trash` in the same statement as the delete, however
 * the response went (one, a selection, a contact erase, retention, a deleted form). The
 * `intelform-file-cleanup` job removes them from storage a few at a time, never in a request:
 *
 *   route after a delete:  await scheduleFileCleanup(c.req.url)   (one job a minute at most)
 *   the job:               drainFileTrash(db, url) and sends itself again while some are left
 *   hourly maintenance:    drainFileTrash too, so nothing stays if a send was refused
 */

export const FILE_CLEANUP_LIST = 'intelform-file-cleanup';
/** Files removed at once. */
export const FILE_CONCURRENCY = 5;
/** Ids read per query. */
const BATCH = 100;
/** A file that can't be removed after this many tries is let go (logged, no personal data). */
const MAX_ATTEMPTS = 5;

export interface DrainResult {
  removed: number;
  failed: number;
  /** Files are still waiting. */
  more: boolean;
}

type Remove = (fileId: string) => Promise<{ok: boolean; code?: string} | undefined>;

/** Removes trashed files until the trash is empty or `budgetMs` is spent. */
export async function drainFileTrash(
  db: Pick<PrismaClient, '$queryRaw' | '$executeRaw'>,
  requestUrl: string,
  opts: {budgetMs?: number; now?: () => number; remove?: Remove} = {}
): Promise<DrainResult> {
  const now = opts.now ?? Date.now;
  const until = now() + (opts.budgetMs ?? 30_000);
  const remove: Remove = opts.remove ?? (id => deleteFile(requestUrl, id) as Promise<{ok: boolean; code?: string}>);
  const out: DrainResult = {removed: 0, failed: 0, more: false};
  // Failed this run: not tried again until the next run.
  const skip: string[] = [];
  while (now() < until) {
    const rows = await db.$queryRaw<{file_id: string}[]>`
      SELECT file_id FROM intelform_file_trash
      WHERE attempts < ${MAX_ATTEMPTS} AND NOT (file_id = ANY(${skip}::text[]))
      ORDER BY created_at, file_id LIMIT ${BATCH}
    `;
    if (!rows.length) break;
    const done: string[] = [];
    const failed: string[] = [];
    let i = 0;
    for (; i < rows.length && now() < until; i += FILE_CONCURRENCY) {
      const group = rows.slice(i, i + FILE_CONCURRENCY).map(r => r.file_id);
      const results = await Promise.allSettled(group.map(id => remove(id)));
      results.forEach((r, k) => {
        const ok = r.status === 'fulfilled' && (r.value?.ok !== false || r.value?.code === 'E_FILE_NOT_FOUND');
        (ok ? done : failed).push(group[k]!);
      });
    }
    if (done.length) await db.$executeRaw`DELETE FROM intelform_file_trash WHERE file_id = ANY(${done}::text[])`;
    if (failed.length) {
      await db.$executeRaw`UPDATE intelform_file_trash SET attempts = attempts + 1 WHERE file_id = ANY(${failed}::text[])`;
      skip.push(...failed);
    }
    out.removed += done.length;
    out.failed += failed.length;
    if (i < rows.length) {
      out.more = true;
      break;
    }
    if (rows.length < BATCH) break;
    if (now() >= until) out.more = true;
  }
  // Let go of files that kept failing (storage off, a file already gone some other way).
  const dropped = await db.$executeRaw`DELETE FROM intelform_file_trash WHERE attempts >= ${MAX_ATTEMPTS}`;
  if (dropped) console.error(`[intelform] ${dropped} stored file(s) could not be removed and were let go`);
  return out;
}

/** Sends the cleanup job (at most one a minute; a refused send is picked up by the hourly run). */
export async function scheduleFileCleanup(requestUrl: string): Promise<void> {
  try {
    await sendJob(requestUrl, FILE_CLEANUP_LIST, {}, {
      key: `file-cleanup-${new Date().toISOString().slice(0, 16)}`,
      label: 'Remove files of deleted responses',
    });
  } catch (err) {
    console.warn(`[intelform] file cleanup not sent (${err instanceof JobRejected ? err.code : 'error'}); the hourly run does it`);
  }
}

/** The job: drain for ~40 s, then send itself again if files are left. */
export async function fileCleanupJob(db: Pick<PrismaClient, '$queryRaw' | '$executeRaw'>, requestUrl: string, step: number): Promise<DrainResult> {
  const result = await drainFileTrash(db, requestUrl, {budgetMs: 40_000});
  if (result.more && step < 50) {
    try {
      await sendJob(requestUrl, FILE_CLEANUP_LIST, {step: step + 1}, {
        key: `file-cleanup-${new Date().toISOString().slice(0, 16)}-${step + 1}`,
        label: 'Remove files of deleted responses (continued)',
      });
    } catch (err) {
      console.warn(`[intelform] file cleanup: next part not sent (${err instanceof JobRejected ? err.code : 'error'})`);
    }
  }
  return result;
}
