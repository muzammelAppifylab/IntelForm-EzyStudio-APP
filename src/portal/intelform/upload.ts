import {putFile, type UploadGrant} from '../../platform/files-browser';
import {
  checkImage,
  IMAGE_RULES,
  type ImagePurpose,
} from '../../server/intelform/uploads/rules';
import {api, ApiRequestError} from './lib/api';

/**
 * Image uploads from the dashboard (builder: logo, question and picture-choice images, social
 * image; app settings: logo, favicon, social image), through the platform's storage
 * (docs/agent/files.md): POST /site-api/uploads → PUT straight to storage → complete.
 *
 * The page must call `allowFileUploads()` in its frontmatter (src/pages/dashboard/[...path].astro
 * does), or the browser blocks the PUT.
 */

export {IMAGE_RULES, checkImage, type ImagePurpose};

/** The picker's help text for a purpose ("PNG, JPG or WebP, up to 5 MB."). */
export const imageHelp = (purpose: ImagePurpose) => IMAGE_RULES[purpose].help;

/** The picker's `accept` attribute (it narrows the picker; it is not a check). */
export const imageAccept = (purpose: ImagePurpose) => IMAGE_RULES[purpose].types.join(',');

export interface UploadedImage {
  /** Site-relative stable link, `/__platform/files/<id>/<name>`: what app settings store. */
  url: string;
  /** The same link, absolute: what form definitions and themes store (they need http(s) URLs). */
  absoluteUrl: string;
  contentType: string;
  size: number;
}

interface UploadStart {
  fileId: string;
  upload: UploadGrant['upload'];
}

/** A field message (wrong type, too large) is the clearest thing to show. */
function preferFieldMessage(err: unknown): never {
  if (err instanceof ApiRequestError && err.fields.file?.[0] && err.fields.file[0] !== err.message) {
    throw new ApiRequestError(err.status, {code: err.code, message: err.fields.file[0], fields: err.fields});
  }
  throw err;
}

/**
 * Uploads one image and resolves with its public link. Throws `ApiRequestError` with a message
 * for people (`errorMessage(err)`): a wrong type or size before anything is sent, then whatever
 * the route or the storage answered. Pass `signal` to let people cancel.
 */
export async function uploadImage(
  file: File,
  purpose: ImagePurpose = 'image',
  {signal}: {signal?: AbortSignal} = {}
): Promise<UploadedImage> {
  const invalid = checkImage(file, purpose);
  if (invalid) throw new ApiRequestError(422, {code: 'invalid_input', message: invalid, fields: {file: [invalid]}});

  const start = await api<UploadStart>('/site-api/uploads', {
    method: 'POST',
    body: {name: file.name || 'image', contentType: file.type, size: file.size, purpose},
    signal,
    fallbackMessage: 'Upload failed. Try again.',
  }).catch(preferFieldMessage);

  const put = await putFile(start.upload, file, {signal});
  if (!put.ok) throw new ApiRequestError(put.status, {code: put.code, message: put.message});

  const done = await api<{url: string; contentType: string; size: number}>(
    `/site-api/uploads/${encodeURIComponent(start.fileId)}/complete`,
    {method: 'POST', signal, fallbackMessage: 'Upload failed. Try again.'}
  ).catch(preferFieldMessage);

  return {
    url: done.url,
    absoluteUrl: new URL(done.url, location.origin).href,
    contentType: done.contentType,
    size: done.size,
  };
}

/** The dashboard link of a stored signature (an `<img src>`; `download` for a link). */
export function signatureSrc(responseId: string, fieldId: string, {download = false} = {}): string {
  const path = `/site-api/uploads/signatures/${encodeURIComponent(responseId)}/${encodeURIComponent(fieldId)}`;
  return download ? `${path}?download=1` : path;
}
