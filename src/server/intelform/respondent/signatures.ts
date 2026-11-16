import type {FormDefinition} from '../../../lib/intelform/form/definition';
import type {Labels} from '../../../lib/intelform/form/labels';
import {claimSignatures, type ClaimInput, type ClaimResult} from '../uploads/signatures';
import {deleteStoredFiles} from '../uploads/storage';
import {RespondentError} from './errors';

/**
 * Signature answers at submit. The browser has already uploaded each drawn PNG straight to
 * storage (src/respondent/upload.ts → POST /site-api/uploads/signature, files.md: bytes never
 * pass through the Worker) and sends `{fileId, token}`. `claimSignatures` verifies the token,
 * completes the upload, re-checks the PNG and rewrites the answer to `{fileId}`: a private
 * file, shown only through the guarded view route (src/server/intelform/uploads/signatures.ts).
 */

export interface SignatureStorage {
  claim(requestUrl: string, input: ClaimInput): Promise<ClaimResult>;
  /** Best effort. */
  remove(requestUrl: string, ids: readonly string[]): Promise<void>;
}

const platformStorage: SignatureStorage = {
  claim: (requestUrl, input) => claimSignatures(requestUrl, input),
  remove: async (requestUrl, ids) => {
    await deleteStoredFiles(requestUrl, ids);
  },
};

let storage: SignatureStorage = platformStorage;
/** Tests replace the storage. */
export function setSignatureStorage(s: SignatureStorage | null): void {
  storage = s ?? platformStorage;
}

/**
 * Claims every signature answer (in place) and returns the claimed file ids, so the caller can
 * remove them if the response is not saved after all. Throws the problem for a bad one.
 */
export async function storeSignatures(
  requestUrl: string,
  formId: string,
  def: FormDefinition,
  answers: Record<string, unknown>,
  labels: Labels
): Promise<string[]> {
  if (!def.fields.some(f => f.type === 'signature' && answers[f.id] !== undefined)) return [];
  const result = await storage.claim(requestUrl, {formId, fields: def.fields, answers, invalidMessage: labels.invalidSignature});
  if (result.ok) return result.fileIds;
  if (result.code === 'validation_failed' && 'fields' in result) {
    throw new RespondentError(422, 'validation_failed', labels.errorSummary, result.fields);
  }
  if (result.status === 413) throw new RespondentError(413, 'payload_too_large', result.message);
  console.error(`intelform signature claim failed: ${result.code}`);
  throw new RespondentError(502, 'storage_failed', 'Your signature couldn’t be saved. Try again in a moment.');
}

export async function removeSignatures(requestUrl: string, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await storage.remove(requestUrl, ids);
  } catch {
    // best effort: an orphaned PNG is harmless and shows in the Storage tab
  }
}
