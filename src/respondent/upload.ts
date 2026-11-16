import {siteFetch} from '../platform/browser';
import {putFile, type UploadGrant} from '../platform/files-browser';
import {checkSignature, SIGNATURE_TYPE} from '../server/intelform/uploads/rules';

/**
 * Signature uploads from the public form (anonymous). The old app sent signatures inside the
 * submit body as PNG data URLs; the Site API's 64 KB body limit no longer allows that, so at
 * submit time each drawn signature is uploaded first (POST /site-api/uploads/signature → PUT
 * straight to storage) and the submit body carries `{fileId, token}` for it. The submit route
 * checks the token, completes the upload and validates the PNG (claimSignatures,
 * src/server/intelform/uploads/signatures.ts).
 *
 * The respondent page must call `allowFileUploads()` in its frontmatter, or the PUT is blocked.
 */

export interface SignatureContext {
  /** The public form's id (`PublicFormLive.id`). */
  formId: string;
  /** The signature field's id. */
  fieldId: string;
  signal?: AbortSignal;
}

/** What goes into `answers[fieldId]` in the submit body. */
export interface SignatureUpload {
  fileId: string;
  token: string;
}

export class SignatureUploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The field the message belongs to, when it is about the signature itself. */
    readonly fieldId?: string
  ) {
    super(message);
  }
}

const FAILED = 'Your signature couldn’t be saved. Try again in a moment.';

/** Uploads one drawn signature (a PNG blob, e.g. from `canvas.toBlob(cb, 'image/png')`). */
export async function uploadSignature(blob: Blob, ctx: SignatureContext): Promise<SignatureUpload> {
  const file = blob.type ? blob : new Blob([blob], {type: SIGNATURE_TYPE});
  const invalid = checkSignature({type: file.type, size: file.size});
  if (invalid) throw new SignatureUploadError(422, 'invalid_input', invalid, ctx.fieldId);

  let res: Response;
  try {
    res = await siteFetch('/site-api/uploads/signature', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({formId: ctx.formId, fieldId: ctx.fieldId, contentType: file.type, size: file.size}),
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    throw new SignatureUploadError(0, 'offline', 'Can’t reach the server. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => null)) as
    | ({fileId: string; upload: UploadGrant['upload']; token: string} & {error?: string; message?: string; fields?: Record<string, string[]>})
    | null;
  if (!res.ok || !body?.fileId || !body.upload || !body.token) {
    const fieldMessage = body?.fields?.[ctx.fieldId]?.[0];
    throw new SignatureUploadError(
      res.status,
      typeof body?.error === 'string' ? body.error : 'upload_failed',
      fieldMessage ?? (typeof body?.message === 'string' ? body.message : FAILED),
      fieldMessage ? ctx.fieldId : undefined
    );
  }

  const put = await putFile(body.upload, file, {signal: ctx.signal});
  if (!put.ok) throw new SignatureUploadError(put.status, put.code, FAILED);
  return {fileId: body.fileId, token: body.token};
}

/** A `data:image/png;base64,…` URL (what a signature pad keeps) as a PNG blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma);
  const type = meta.split(';')[0] || SIGNATURE_TYPE;
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type});
}

const isPngDataUrl = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/png;base64,');

/**
 * Before submit: uploads every drawn signature among `answers` (`{url: 'data:image/png…'}` from
 * the signature pad) and returns a copy of the answers with `{fileId, token}` in their place.
 * Signatures already uploaded (`{fileId, token}`) are kept. Throws `SignatureUploadError`.
 */
export async function prepareSignatureAnswers(
  fields: readonly {id: string; type: string}[],
  answers: Record<string, unknown>,
  formId: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const out = {...answers};
  for (const f of fields) {
    if (f.type !== 'signature') continue;
    const v = answers[f.id] as {url?: unknown} | undefined;
    if (!v || typeof v !== 'object' || !isPngDataUrl(v.url)) continue;
    out[f.id] = await uploadSignature(dataUrlToBlob(v.url), {formId, fieldId: f.id, signal});
  }
  return out;
}
