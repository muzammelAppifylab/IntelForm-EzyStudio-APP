import {completeUpload, getFile} from '../../../platform/files';
import {config} from '../../../platform/config';
import {validatePng, PngError} from './png';
import {
  isFileId,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_NAME,
  SIGNATURE_TYPE,
  SIGNATURES_PER_SUBMIT_MAX_BYTES,
} from './rules';
import {deleteStoredFiles, guarded, readStoredBytes} from './storage';
import {verifyUploadToken} from './token';

/**
 * Signature answers, the server half (for the public submit route, the responses routes, the
 * webhook and notification code). Replaces the old app's data-URL signatures, which the 64 KB
 * Site API body limit no longer allows:
 *
 *   1. respondent draws  → `uploadSignature(blob, {formId, fieldId})` (src/respondent/upload.ts):
 *      POST /site-api/uploads/signature, PUT straight to storage. The file stays PENDING.
 *   2. the submit body carries `answers[fieldId] = {fileId, token}`.
 *   3. the submit route calls `claimSignatures()` BEFORE its transaction: it verifies each token
 *      (this site made that file for this form's field), completes the upload, reads the PNG back
 *      and runs the strict PNG check, then rewrites the answer to the STORED form `{fileId}`.
 *      If the transaction fails afterwards, `deleteStoredFiles(requestUrl, claimed)`.
 *   4. a submit that never happens leaves a pending file, which the platform deletes after about
 *      an hour: no orphan signatures.
 *
 * Signatures are PRIVATE files (personal data, docs/agent/files.md), stored as `{fileId}`.
 * They are only ever shown through GET /site-api/uploads/signatures/:responseId/:fieldId, which
 * checks site:response:read and redirects to a 5-minute link (`signatureViewPath`): the
 * responses table, drawer, CSV, notification emails and webhooks all carry that path, never a
 * storage link. Answers saved before this change hold `{url: "/__platform/files/<id>/…"}`;
 * every reader also takes the file id from that shape. A respondent never chooses the file:
 * only one this site created for this form's field (signed token) and that passed the PNG
 * check is kept.
 */

/** The stored answer of a signature field. */
export interface StoredSignature {
  fileId: string;
}

/** The submitted answer of a signature field (before `claimSignatures`). */
export interface SubmittedSignature {
  fileId: string;
  token: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The file id of a STORED signature answer; null for anything else (old CDN URLs included). */
export function storedSignatureFileId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (isFileId(value.fileId)) return value.fileId;
  const m = typeof value.url === 'string' ? STORED_URL.exec(value.url) : null;
  return m && isFileId(m[1]) ? m[1] : null;
}

const STORED_URL = /^\/__platform\/files\/([^/?#]+)\//;

/** Every stored signature file id in one response's answers. */
export function answersSignatureFileIds(answers: unknown): string[] {
  if (!isRecord(answers)) return [];
  return Object.values(answers)
    .map(storedSignatureFileId)
    .filter((id): id is string => id !== null);
}

/** The dashboard's view link of one signature (checks RESPONSE_READ on every view). */
export function signatureViewPath(responseId: string, fieldId: string): string {
  return `/site-api/uploads/signatures/${encodeURIComponent(responseId)}/${encodeURIComponent(fieldId)}`;
}


export type ClaimResult =
  | {ok: true; fileIds: string[]}
  | {ok: false; status: 422; code: 'validation_failed'; fields: Record<string, string[]>}
  | {ok: false; status: 413; code: 'payload_too_large'; message: string}
  | {ok: false; status: 502 | 503; code: string; message: string};

export interface ClaimInput {
  formId: string;
  /** The fields of the version the browser rendered (only `id` and `type` are read). */
  fields: readonly {id: string; type: string}[];
  /** The submitted answers. Signature answers are rewritten IN PLACE to `{fileId}`. */
  answers: Record<string, unknown>;
  /** Message for a bad signature (the form's labels: `invalidSignature`). */
  invalidMessage: string;
  /** For tests. */
  now?: number;
}

/**
 * Step 3 above. Call it after the cheap checks (live, cap, one per email…) and validation of
 * the other answers, so a doomed submit claims nothing. On success the answers hold `{fileId}`
 * for every signature and `fileIds` lists them (delete them if the response is not saved after
 * all). On failure nothing stays claimed: files it completed are deleted again.
 */
export async function claimSignatures(requestUrl: string | URL, input: ClaimInput): Promise<ClaimResult> {
  const secret = config.jwtSecret;
  const pending: {fieldId: string; fileId: string}[] = [];
  const invalid = (fieldId: string): ClaimResult => ({
    ok: false,
    status: 422,
    code: 'validation_failed',
    fields: {[fieldId]: [input.invalidMessage]},
  });

  for (const f of input.fields) {
    if (f.type !== 'signature') continue;
    const v = input.answers[f.id];
    if (v === undefined) continue;
    if (!isRecord(v) || !isFileId(v.fileId) || typeof v.token !== 'string' || !secret) return invalid(f.id);
    const claim = await verifyUploadToken(secret, v.token, input.now);
    if (!claim || claim.fileId !== v.fileId || claim.formId !== input.formId || claim.fieldId !== f.id) return invalid(f.id);
    if (pending.some(p => p.fileId === v.fileId)) return invalid(f.id);
    pending.push({fieldId: f.id, fileId: v.fileId});
  }
  if (!pending.length) return {ok: true, fileIds: []};

  const claimed: string[] = [];
  const fail = async (result: ClaimResult): Promise<ClaimResult> => {
    await deleteStoredFiles(requestUrl, claimed);
    return result;
  };
  let total = 0;
  for (const {fieldId, fileId} of pending) {
    // A file already completed was claimed by an earlier submit: one signature, one response.
    const info = await guarded(() => getFile(requestUrl, fileId));
    if (!info.ok) {
      if (info.status === 503 || info.status === 0) {
        return fail({ok: false, status: info.status === 503 ? 503 : 502, code: info.code, message: info.message});
      }
      return fail(invalid(fieldId));
    }
    if (
      info.data.status !== 'pending' ||
      info.data.visibility !== 'private' ||
      info.data.name !== SIGNATURE_NAME ||
      info.data.contentType !== SIGNATURE_TYPE
    ) {
      return fail(invalid(fieldId));
    }
    const done = await guarded(() => completeUpload(requestUrl, fileId));
    if (!done.ok) {
      if (done.status === 503 || done.code === 'E_PLATFORM_UNREACHABLE') {
        return fail({ok: false, status: 502, code: 'storage_failed', message: 'Your signature couldn’t be saved. Try again in a moment.'});
      }
      return fail(invalid(fieldId));
    }
    claimed.push(fileId);
    if (done.data.size > SIGNATURE_MAX_BYTES) return fail(invalid(fieldId));
    total += done.data.size;
    if (total > SIGNATURES_PER_SUBMIT_MAX_BYTES) {
      return fail({
        ok: false,
        status: 413,
        code: 'payload_too_large',
        message: 'Your signatures are too large to save. Clear them, sign again and resubmit.',
      });
    }
    const read = await readStoredBytes(requestUrl, fileId, SIGNATURE_MAX_BYTES, {exact: true});
    if (!read.ok) {
      return fail(
        read.status === 413
          ? invalid(fieldId)
          : {ok: false, status: 502, code: 'storage_failed', message: 'Your signature couldn’t be saved. Try again in a moment.'}
      );
    }
    try {
      await validatePng(read.bytes);
    } catch (err) {
      if (!(err instanceof PngError)) throw err;
      return fail(invalid(fieldId));
    }
    input.answers[fieldId] = {fileId} satisfies StoredSignature;
  }
  return {ok: true, fileIds: claimed};
}
