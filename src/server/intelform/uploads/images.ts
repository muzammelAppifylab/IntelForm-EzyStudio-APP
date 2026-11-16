import {completeUpload, createUpload, deleteFile, getFile, publicFileUrl} from '../../../platform/files';
import type {UploadGrant} from '../../../platform/files';
import {checkImage, imageFileName, maxBytesFor, purposeOfImageName, type ImagePurpose} from './rules';
import {isCleanSvg, sniffImageType} from './sniff';
import {guarded, readStoredBytes, type Failure} from './storage';

/**
 * Images a team member picks (form logo, question and picture-choice images, social preview
 * image; the app's logo, favicon and social image). Public files: they show on public forms and
 * pages through their stable `/__platform/files/<id>/<name>` link (`isUploadedFileUrl` in
 * src/lib/intelform/settings-app.ts accepts only those).
 */

/** What the complete step answers (the old app's UploadResult). */
export interface ImageUploadResult {
  url: string;
  contentType: string;
  size: number;
}

export interface ImageUploadInput {
  name: string;
  contentType: string;
  size: number;
  purpose: ImagePurpose;
}

/** Step 1: this feature's limits, then a one-time upload URL for a PUBLIC file. */
export async function startImageUpload(
  requestUrl: string | URL,
  input: ImageUploadInput
): Promise<{ok: true; data: UploadGrant} | Failure> {
  const invalid = checkImage({type: input.contentType, size: input.size}, input.purpose);
  if (invalid) return {ok: false, status: 422, code: 'invalid_input', message: invalid};
  return guarded(() =>
    createUpload(requestUrl, {
      name: imageFileName(input.purpose, input.contentType),
      contentType: input.contentType,
      size: input.size,
      visibility: 'public',
    })
  );
}

/** Bytes read back to check a raster image's type. */
const SNIFF_BYTES = 64;

/**
 * Step 3: confirms the upload, then checks the file really is the image it was uploaded as
 * (the old app sniffed every upload; SVG must carry no active content). A file that fails is
 * deleted. Only files this route created can be completed here: a public image named
 * `<purpose>.<ext>`, whose purpose `allowed(purpose)` lets this viewer upload.
 */
export async function completeImageUpload(
  requestUrl: string | URL,
  fileId: string,
  allowed: (purpose: ImagePurpose) => boolean
): Promise<{ok: true; data: ImageUploadResult} | Failure> {
  const notFound: Failure = {ok: false, status: 404, code: 'not_found', message: 'No such upload.'};
  const info = await guarded(() => getFile(requestUrl, fileId));
  if (!info.ok) return info.status === 503 ? info : notFound;
  const purpose = purposeOfImageName(info.data.name);
  if (!purpose || info.data.visibility !== 'public') return notFound;
  if (!allowed(purpose)) return {ok: false, status: 403, code: 'forbidden', message: 'You do not have access to this.'};

  let file = info.data;
  if (file.status !== 'ready') {
    const done = await guarded(() => completeUpload(requestUrl, fileId));
    if (!done.ok) return {...done, status: done.status === 503 ? 503 : 400};
    file = done.data;
  }

  const reject = async (message: string): Promise<Failure> => {
    await guarded(() => deleteFile(requestUrl, fileId)).catch(() => null);
    return {ok: false, status: 422, code: 'invalid_file', message};
  };
  // The platform checked size and type against what was asked for; check our own limits and
  // the bytes too.
  if (checkImage({type: file.contentType, size: file.size}, purpose)) {
    return reject(checkImage({type: file.contentType, size: file.size}, purpose)!);
  }
  const isSvg = file.contentType === 'image/svg+xml';
  const read = await readStoredBytes(requestUrl, fileId, isSvg ? maxBytesFor(purpose, file.contentType) : SNIFF_BYTES, {
    exact: isSvg,
  });
  if (!read.ok) return read.status === 413 ? reject('That file is too large.') : read;
  if (sniffImageType(read.bytes) !== file.contentType) {
    return reject('That file isn’t the image it says it is. Export it again as PNG, JPG or WebP.');
  }
  if (isSvg && !isCleanSvg(new TextDecoder().decode(read.bytes))) {
    return reject('This SVG contains scripts, links or other active content. Export a plain SVG or use a PNG.');
  }
  return {ok: true, data: {url: publicFileUrl(file), contentType: file.contentType, size: file.size}};
}
