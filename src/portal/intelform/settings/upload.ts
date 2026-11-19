import {putFile} from '../../../platform/files-browser';
import {isUploadedFileUrl, type UploadPurpose} from '../../../lib/intelform/settings-app';
import {checkImage as checkImageRule, IMAGE_RULES} from '../../../server/intelform/uploads/rules';
import {api, ApiRequestError} from '../lib/api';

/**
 * What each settings image accepts, in words, for the picker's help text. The types and sizes
 * come from the rules the uploads route enforces (src/server/intelform/uploads/rules.ts).
 */
export const UPLOAD_HELP: Record<UploadPurpose, string> = {
  logo: IMAGE_RULES.logo.help,
  favicon: `Square, 64 × 64 px or larger. ${IMAGE_RULES.favicon.help}`,
  image: IMAGE_RULES.image.help,
  og: `1200 × 630 px works best. ${IMAGE_RULES.og.help}`,
};

/** The browser-side check before an upload starts (the uploads route checks the same again); null = fine. */
export function checkImage(file: {type: string; size: number}, purpose: UploadPurpose): string | null {
  return checkImageRule(file, purpose);
}

/**
 * The site path settings store for an uploaded file: `/__platform/files/<id>/<name>`, whether the
 * complete step answered with a path or a full URL on this site. Null for anything else.
 */
export function storedPath(url: string, origin: string): string | null {
  let path = url;
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== new URL(origin).origin) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }
  return isUploadedFileUrl(path) ? path : null;
}

interface UploadStart {
  fileId: string;
  upload: Parameters<typeof putFile>[0];
}

/**
 * Uploads a settings image (logo, favicon, social image) through the platform's files
 * (files.md: create → PUT straight to storage → complete) and returns the path to save.
 * Routes (uploads domain): POST /site-api/uploads {name, contentType, size, purpose} → {fileId, upload};
 * POST /site-api/uploads/:fileId/complete → {url}.
 */
export async function uploadSettingsImage(file: File, purpose: UploadPurpose): Promise<string> {
  const invalid = checkImage(file, purpose);
  if (invalid) throw new ApiRequestError(422, {code: 'invalid_input', message: invalid});
  const start = await api<UploadStart>('/site-api/uploads', {
    method: 'POST',
    body: {name: file.name, contentType: file.type, size: file.size, purpose},
    fallbackMessage: 'The upload failed. Try again.',
  }).catch((err: unknown) => {
    if (err instanceof ApiRequestError && err.fields.file?.[0]) throw new ApiRequestError(err.status, {code: err.code, message: err.fields.file[0]});
    throw err;
  });
  const put = await putFile(start.upload, file);
  if (!put.ok) throw new ApiRequestError(put.status ?? 0, {code: put.code, message: put.message});
  const done = await api<{url: string}>(`/site-api/uploads/${encodeURIComponent(start.fileId)}/complete`, {
    method: 'POST',
    fallbackMessage: 'The upload failed. Try again.',
  });
  const path = storedPath(done.url, location.origin);
  if (!path) throw new ApiRequestError(0, {code: 'upload_failed', message: 'The upload finished, but its address looks wrong. Try again.'});
  return path;
}
