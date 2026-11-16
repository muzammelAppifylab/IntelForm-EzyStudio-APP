import {siteFetch} from '../../../platform/browser';
import {putFile} from '../../../platform/files-browser';
import type {FormPatchInput, FormPatchResponse} from '../../../lib/intelform/api-forms';
import {api, ApiRequestError, parseErrorBody} from '../lib/api';

export interface SendOptions {
  /** Let the request finish even if the page unloads (tab hidden or closing). */
  keepalive?: boolean;
}

/** Browsers cap a keepalive request's body at 64 KB. */
const KEEPALIVE_MAX = 60_000;

const formPath = (formId: string) => `/site-api/forms/${encodeURIComponent(formId)}`;

/** PATCH /site-api/forms/:id with the revision it was based on (`If-Match`; last save wins). */
export async function patchForm(
  formId: string,
  body: FormPatchInput,
  revision: number,
  opts: SendOptions = {}
): Promise<FormPatchResponse> {
  const json = JSON.stringify(body);
  let res: Response;
  try {
    res = await siteFetch(formPath(formId), {
      method: 'PATCH',
      credentials: 'same-origin',
      keepalive: !!opts.keepalive && json.length <= KEEPALIVE_MAX,
      headers: {'Content-Type': 'application/json', 'If-Match': `"${revision}"`},
      body: json,
    });
  } catch {
    throw new ApiRequestError(0, {
      code: 'offline',
      message: 'Can’t reach the server. Your changes are kept here and saved when you’re back online.',
    });
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, parseErrorBody(data, 'Saving failed. Try again.'));
  return data as FormPatchResponse;
}

/**
 * Last-chance save when the tab is hidden or closed. keepalive requests are capped at 64 KB,
 * so a huge draft can't be flushed this way; beforeunload asks the browser to warn instead.
 * `siteFetch` adds the CSRF header (read from the cookie, so no extra round trip once loaded).
 */
export function keepalivePatch(formId: string, body: FormPatchInput, revision: number): boolean {
  const json = JSON.stringify(body);
  if (json.length > KEEPALIVE_MAX) return false;
  try {
    void siteFetch(formPath(formId), {
      method: 'PATCH',
      credentials: 'same-origin',
      keepalive: true,
      headers: {'Content-Type': 'application/json', 'If-Match': `"${revision}"`},
      body: json,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ uploads --

export type UploadPurpose = 'logo' | 'image' | 'og';

/**
 * IntelForm's image limits, one place for the picker's help text and the browser check
 * (the uploads route checks the same again): 5 MB, JPG / PNG / WebP, SVG for logos too.
 */
export const UPLOAD_RULES: Record<UploadPurpose, {types: readonly string[]; maxBytes: number; help: string}> = {
  logo: {
    types: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    maxBytes: 5 * 1024 * 1024,
    help: 'PNG, JPG, WebP or SVG, up to 5 MB.',
  },
  image: {types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * 1024 * 1024, help: 'PNG, JPG or WebP, up to 5 MB.'},
  og: {types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * 1024 * 1024, help: 'PNG, JPG or WebP, up to 5 MB.'},
};

/** A quick browser-side check before an upload starts; null when the file is fine. */
export function checkUpload(file: {type: string; size: number}, purpose: UploadPurpose): string | null {
  const rule = UPLOAD_RULES[purpose];
  if (!rule.types.includes(file.type)) return `That file type isn’t supported. ${rule.help}`;
  if (file.size < 1) return 'That file is empty.';
  if (file.size > rule.maxBytes) return `That file is too large. ${rule.help}`;
  return null;
}

/** POST /site-api/uploads answers this (step 1, files.md). */
interface UploadStart {
  fileId: string;
  upload: Parameters<typeof putFile>[0];
}

/**
 * Uploads an image for a form (logo, question image, social image) through the platform's file
 * storage (files.md: create → PUT straight to storage → complete), and returns the absolute URL
 * the definition / theme stores. The files are public (they show on public forms), so the
 * complete step answers with their stable `publicFileUrl`.
 *
 * Routes (uploads domain): POST /site-api/uploads {name, contentType, size, purpose}
 * → {fileId, upload}; POST /site-api/uploads/:fileId/complete → {url}.
 * The dashboard page must call `allowFileUploads()` in its frontmatter, or the PUT is blocked.
 */
export async function uploadImage(file: File, purpose: UploadPurpose): Promise<string> {
  const invalid = checkUpload(file, purpose);
  if (invalid) throw new ApiRequestError(422, {code: 'invalid_input', message: invalid, fields: {file: [invalid]}});
  const start = await api<UploadStart>('/site-api/uploads', {
    method: 'POST',
    body: {name: file.name, contentType: file.type, size: file.size, purpose},
    fallbackMessage: 'Upload failed. Try again.',
  }).catch((err: unknown) => {
    // A field message (wrong type, too large) is the clearest thing to show.
    if (err instanceof ApiRequestError && err.fields.file?.[0])
      throw new ApiRequestError(err.status, {code: err.code, message: err.fields.file[0], fields: err.fields});
    throw err;
  });
  const put = await putFile(start.upload, file);
  if (!put.ok) throw new ApiRequestError(put.status ?? 0, {code: put.code, message: put.message});
  const done = await api<{url: string}>(`/site-api/uploads/${encodeURIComponent(start.fileId)}/complete`, {
    method: 'POST',
    fallbackMessage: 'Upload failed. Try again.',
  });
  // Definitions and themes only accept absolute http(s) URLs (safeUrl).
  return new URL(done.url, location.origin).href;
}
