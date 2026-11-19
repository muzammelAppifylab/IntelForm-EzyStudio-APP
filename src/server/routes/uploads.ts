import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {fileUrl} from '../../platform/files';
import {permissionScope, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {completeImageUpload, startImageUpload} from '../intelform/uploads/images';
import {hitRateLimit, waitText} from '../intelform/uploads/rate-limit';
import {checkImage, IMAGE_RATE, isFileId, isImagePurpose, type ImagePurpose} from '../intelform/uploads/rules';
import {storedSignatureFileId} from '../intelform/uploads/signatures';
import {guarded} from '../intelform/uploads/storage';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/uploads/*`: IntelForm's files, through the platform's storage (docs/agent/files.md).
 * Replaces the old app's local-disk / Bunny uploads: the bytes go straight from the browser to
 * the storage, never through the Worker.
 *
 *   POST /                      editors: start an IMAGE upload {name, contentType, size, purpose}
 *                               → 201 {fileId, upload}                      (public file)
 *   POST /:fileId/complete      editors: confirm it, check the bytes → {url, contentType, size}
 *   POST /signature             ANONYMOUS: a respondent's signature upload. NOT here: in
 *                               public-signatures.ts, mounted before `csrf` (embedded forms);
 *                               everything in THIS file stays behind `csrf`.
 *   GET  /signatures/:responseId/:fieldId
 *                               RESPONSE_READ: 302 to a 5-minute link of that signature
 *
 * Who may upload which image: question images, form logos and social images need
 * FORM_WRITE (or APP_SETTINGS, for the app's own logo and social image); the favicon is the
 * app's only and needs APP_SETTINGS. The old app let Owner and Editor upload (plus avatars,
 * which the template's account pages now own).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;

const tooMany = (retryAfter: number) => problem('rate_limited', `Too many uploads. Wait ${waitText(retryAfter)} and try again.`);

/** Which images this viewer may upload (one permission lookup per request). */
async function imagePermissions(holds: (codename: string) => Promise<boolean>): Promise<(purpose: ImagePurpose) => boolean> {
  const [forms, app] = await Promise.all([holds(PERMISSIONS.FORM_WRITE), holds(PERMISSIONS.APP_SETTINGS)]);
  return purpose => (purpose === 'favicon' ? app : forms || app);
}

const imageBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 200) : '';
  const contentType = typeof v.contentType === 'string' ? v.contentType : '';
  const size = typeof v.size === 'number' ? v.size : 0;
  if (!isImagePurpose(v.purpose)) {
    return c.json(problem('invalid_input', 'Say what the image is for: logo, favicon, image or og.'), 422);
  }
  const invalid = checkImage({type: contentType, size}, v.purpose);
  if (!name || invalid) {
    const message = invalid ?? 'Choose an image to upload.';
    return c.json({...problem('invalid_input', message), fields: {file: [message]}}, 422);
  }
  return {name, contentType, size, purpose: v.purpose};
});

const fileIdParam = validator('param', (value, c) => {
  const fileId = (value as {fileId?: string}).fileId;
  if (!isFileId(fileId)) return c.json(problem('not_found', 'No such upload.'), 404);
  return {fileId};
});

const signatureParam = validator('param', (value, c) => {
  const {responseId, fieldId} = value as {responseId?: string; fieldId?: string};
  if (!responseId || !UUID.test(responseId) || !fieldId || !FIELD_ID.test(fieldId)) {
    return c.json(problem('not_found', 'No such signature.'), 404);
  }
  return {responseId, fieldId};
});

export const uploadsRoutes = new Hono()
  // 1. Images: ask for an upload URL (editors).
  .post('/', imageBody, withViewer, requireAuth, withDb, async c => {
    const input = c.req.valid('json');
    const allowed = await imagePermissions(async codename => (await permissionScope(c, codename)) === 'all');
    if (!allowed(input.purpose)) return c.json(problem('forbidden', 'You do not have access to this.'), 403);
    const limited = await hitRateLimit(c.var.db, `upload:user:${c.var.viewer.id}`, IMAGE_RATE.limit, IMAGE_RATE.windowSeconds);
    if (!limited.ok) {
      c.header('Retry-After', String(limited.retryAfter));
      return c.json(tooMany(limited.retryAfter), 429);
    }
    const grant = await startImageUpload(c.req.url, input);
    if (!grant.ok) {
      const status = grant.status === 402 ? 402 : grant.status === 422 ? 422 : grant.status === 503 ? 503 : 400;
      return c.json({...problem(grant.code, grant.message), fields: {file: [grant.message]}}, status);
    }
    return c.json({fileId: grant.data.file.id, upload: grant.data.upload}, 201);
  })

  // 3. Images: confirm after the browser's PUT; answers the public link.
  .post('/:fileId/complete', fileIdParam, withViewer, requireAuth, async c => {
    const {fileId} = c.req.valid('param');
    const allowed = await imagePermissions(async codename => (await permissionScope(c, codename)) === 'all');
    const done = await completeImageUpload(c.req.url, fileId, allowed);
    if (!done.ok) {
      const status =
        done.status === 403 ? 403 : done.status === 404 ? 404 : done.status === 422 ? 422 : done.status === 503 ? 503 : done.status === 502 ? 502 : 400;
      return c.json({...problem(done.code, done.message), fields: {file: [done.message]}}, status);
    }
    return c.json({url: done.data.url, contentType: done.data.contentType, size: done.data.size});
  })

  // Signatures: view one (dashboard). Checks access on every view; links last 5 minutes.
  .get(
    '/signatures/:responseId/:fieldId',
    signatureParam,
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const {responseId, fieldId} = c.req.valid('param');
      const response = await c.var.db.response.findUnique({where: {id: responseId}, select: {answers: true}});
      const answers = response?.answers as Record<string, unknown> | null | undefined;
      const fileId = answers ? storedSignatureFileId(answers[fieldId]) : null;
      if (!fileId) return c.json(problem('not_found', 'No such signature.'), 404);
      const link = await guarded(() =>
        fileUrl(c.req.url, fileId, {expiresIn: 300, download: c.req.query('download') === '1'})
      );
      if (!link.ok) {
        return c.json(problem(link.code, link.message), link.status === 503 ? 503 : link.status === 404 ? 404 : 502);
      }
      c.header('Cache-Control', 'private, no-store');
      return c.redirect(link.data.url, 302);
    }
  );
