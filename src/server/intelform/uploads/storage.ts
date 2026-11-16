import {SiteKeyMissing} from '../../../platform/api';
import {deleteFile, fileUrl} from '../../../platform/files';

/**
 * Small wrappers over the platform's file storage (src/platform/files.ts) for IntelForm's
 * uploads: read a stored file back for a check, and delete files without ever throwing.
 */

export type Failure = {ok: false; status: number; code: string; message: string};

export const NO_STORAGE: Failure = {
  ok: false,
  status: 503,
  code: 'storage_not_configured',
  message: 'File storage isn’t set up on this site yet. Ask the owner.',
};

/** Runs a platform files call; a missing Site Key becomes a 503 answer instead of a throw. */
export async function guarded<T>(call: () => Promise<T>): Promise<T | Failure> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof SiteKeyMissing) return NO_STORAGE;
    throw err;
  }
}

/**
 * The first `maxBytes` bytes of a ready file (all of it when it is smaller), read through a
 * one-minute link. `exact` = the file must not be longer than `maxBytes` (a whole-file check).
 */
export async function readStoredBytes(
  requestUrl: string | URL,
  fileId: string,
  maxBytes: number,
  {exact = false}: {exact?: boolean} = {}
): Promise<{ok: true; bytes: Uint8Array} | Failure> {
  const link = await guarded(() => fileUrl(requestUrl, fileId, {expiresIn: 60}));
  if (!link.ok) return link;
  let res: Response;
  try {
    res = await fetch(link.data.url, {
      headers: exact ? {} : {range: `bytes=0-${maxBytes - 1}`},
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {ok: false, status: 502, code: 'storage_unreachable', message: 'The stored file couldn’t be checked. Try again.'};
  }
  if (!res.ok || !res.body) {
    return {ok: false, status: 502, code: 'storage_unreachable', message: 'The stored file couldn’t be checked. Try again.'};
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
    if (total >= maxBytes) {
      if (exact && total > maxBytes) {
        await reader.cancel().catch(() => {});
        return {ok: false, status: 413, code: 'file_too_large', message: 'That file is too large.'};
      }
      if (!exact) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const bytes = new Uint8Array(Math.min(total, exact ? total : maxBytes));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.length, bytes.length - at);
    if (take <= 0) break;
    bytes.set(p.subarray(0, take), at);
    at += take;
  }
  return {ok: true, bytes};
}

/**
 * Deletes stored files. Never throws and never fails the caller: a file that can't be deleted
 * now is logged (no personal data) and left; the caller carries on, as the old app did.
 */
export async function deleteStoredFiles(requestUrl: string | URL, fileIds: readonly string[]): Promise<void> {
  const ids = [...new Set(fileIds)];
  if (!ids.length) return;
  const results = await Promise.allSettled(ids.map(id => deleteFile(requestUrl, id)));
  const failed = results.filter(
    r => r.status === 'rejected' || (r.value.ok === false && r.value.code !== 'E_FILE_NOT_FOUND')
  ).length;
  if (failed) console.error(`intelform uploads: ${failed} of ${ids.length} stored file deletes failed`);
}
