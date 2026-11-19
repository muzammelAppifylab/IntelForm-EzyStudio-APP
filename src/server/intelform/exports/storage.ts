import {completeUpload, createUpload, deleteFile, fileUrl} from '../../../platform/files';
import {putFile} from '../../../platform/files-browser';
import {guarded} from '../uploads/storage';

/**
 * Export files in the platform's file storage (docs/agent/files.md), from the export job. The
 * job is server code with the Site Key, so it takes the same three steps a browser upload does,
 * all on the server: `createUpload()` for the file's exact size and type, the PUT of the bytes
 * straight to the storage (`putFile()` is a plain `fetch`, it runs on the Worker too), then
 * `completeUpload()`. The bytes never pass through `/site-api` or the database. Files are
 * private; the download route checks who asks, then hands out short links (`fileUrl()`).
 */

export type StoreFailure = {ok: false; code: string; message: string; retry: boolean};

/** Codes no retry can fix: the owner has to add or turn on storage, or free room. */
const FINAL = new Set(['E_STORAGE_NEEDS_PACK', 'E_STORAGE_OFF', 'E_STORAGE_UNAVAILABLE', 'E_STORAGE_LIMIT', 'E_FILE_TYPE', 'E_FILE_TOO_LARGE', 'storage_not_configured']);

const NO_ROOM =
  'This export needs file storage. Ask the owner to add storage on the dashboard’s Storage page and turn it on for this app, then export again.';

function failure(code: string, message: string): StoreFailure {
  const final = FINAL.has(code);
  return {ok: false, code, message: final ? NO_ROOM : message, retry: !final};
}

export interface ExportFileStore {
  /** Step 1: a one-time upload for `size` bytes; the id is saved before the bytes go. */
  begin(name: string, contentType: string, size: number): Promise<{ok: true; fileId: string; upload: unknown} | StoreFailure>;
  /** Steps 2 and 3: the bytes, then the platform's check. */
  finish(fileId: string, upload: unknown, body: Blob): Promise<{ok: true} | StoreFailure>;
  remove(fileId: string): Promise<void>;
  /** A short-lived download link (after the route's own checks). */
  link(fileId: string, expiresIn: number): Promise<{ok: true; url: string} | StoreFailure>;
}

/** The platform's storage for one request's (or job's) address. */
export function platformStore(requestUrl: string): ExportFileStore {
  return {
    async begin(name, contentType, size) {
      const grant = await guarded(() => createUpload(requestUrl, {name, contentType, size, visibility: 'private'}));
      if (!grant.ok) return failure(grant.code, grant.message);
      return {ok: true, fileId: grant.data.file.id, upload: grant.data.upload};
    },
    async finish(fileId, upload, body) {
      const put = await putFile(upload as Parameters<typeof putFile>[0], body);
      if (!put.ok) return failure(put.code, put.message);
      const done = await guarded(() => completeUpload(requestUrl, fileId));
      if (!done.ok) return failure(done.code, done.message);
      return {ok: true};
    },
    async remove(fileId) {
      await guarded(() => deleteFile(requestUrl, fileId)).catch(() => undefined);
    },
    async link(fileId, expiresIn) {
      const link = await guarded(() => fileUrl(requestUrl, fileId, {expiresIn, download: true}));
      if (!link.ok) return failure(link.code, link.message);
      return {ok: true, url: link.data.url};
    },
  };
}
