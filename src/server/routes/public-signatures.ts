import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {config} from '../../platform/config';
import {createUpload} from '../../platform/files';
import {problem, withDb} from '../../platform/guards';
import {SYSTEM_LABELS} from '../../lib/intelform/form/labels';
import {checkUnlockToken} from '../intelform/respondent/tokens';
import {callerKey, waitText} from '../intelform/uploads/rate-limit';
import {checkSignature, SIGNATURE_NAME, SIGNATURE_RATE, SIGNATURE_TOKEN_TTL_SECONDS, SIGNATURE_TYPE} from '../intelform/uploads/rules';
import {guarded} from '../intelform/uploads/storage';
import {signUploadToken} from '../intelform/uploads/token';
import {readRenderHeader, RENDER_HEADER} from './public-forms';

/**
 * `POST /site-api/uploads/signature`: ANONYMOUS, rate limited. Starts a respondent's SIGNATURE
 * upload {formId, fieldId, contentType, size, unlockToken?} → 201 {fileId, upload, token}
 * (a private file, pending until the submit route claims it: src/server/intelform/uploads/signatures.ts).
 *
 * Mounted in app.ts with the public form routes: after `sameOrigin`, BEFORE `csrf` (a form
 * embedded on another website has no CSRF cookie in its iframe). It reads no cookie and no
 * viewer; instead it needs the page's render token for THIS form in `x-intelform-render`
 * (public-forms.ts RENDER_HEADER says why that is enough), checked before any database work, and
 * for a password-protected form its unlock token, as the submit does. The editors' image uploads
 * stay in uploads.ts, behind `csrf`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A respondent mid-way through when the owner republished may still sign the version they see. */
const PREVIOUS_VERSION_GRACE_MS = 24 * 60 * 60 * 1000;

const tooMany = (retryAfter: number) => problem('rate_limited', `Too many uploads. Wait ${waitText(retryAfter)} and try again.`);

const signatureBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const formId = typeof v.formId === 'string' ? v.formId : '';
  const fieldId = typeof v.fieldId === 'string' ? v.fieldId : '';
  const contentType = typeof v.contentType === 'string' ? v.contentType : '';
  const size = typeof v.size === 'number' ? v.size : 0;
  const unlockToken = typeof v.unlockToken === 'string' && v.unlockToken.length <= 400 ? v.unlockToken : null;
  if (!UUID.test(formId) || !FIELD_ID.test(fieldId)) {
    return c.json(problem('not_found', 'This form is no longer available.'), 404);
  }
  const invalid = checkSignature({type: contentType, size});
  if (invalid) return c.json({...problem('invalid_input', invalid), fields: {[fieldId]: [invalid]}}, 422);
  return {formId, fieldId, contentType, size, unlockToken};
});

/**
 * Both signature limits (per caller and form, per caller) in ONE statement. Rows are always
 * taken in the same order (this form's key, then the caller's), so concurrent uploads can't
 * deadlock on them.
 */
async function hitSignatureLimits(
  db: Pick<PrismaClient, '$queryRaw'>,
  caller: string,
  formId: string
): Promise<{ok: true} | {ok: false; retryAfter: number}> {
  const {perForm, perCaller} = SIGNATURE_RATE;
  const formKey = `upload:sig:${caller}:${formId}`;
  const rows = await db.$queryRaw<{key: string; count: number; retry: number}[]>`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES
      (${formKey}, date_bin(make_interval(secs => ${perForm.windowSeconds}::int), now(), 'epoch'), ${perForm.windowSeconds}::int, 1),
      (${`upload:sig:${caller}`}, date_bin(make_interval(secs => ${perCaller.windowSeconds}::int), now(), 'epoch'), ${perCaller.windowSeconds}::int, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING key, count::int AS count,
      ceil(extract(epoch FROM (window_start + make_interval(secs => window_seconds) - now())))::int AS retry
  `;
  let retryAfter = 0;
  for (const row of rows) {
    const limit = row.key === formKey ? perForm.limit : perCaller.limit;
    if (row.count > limit) retryAfter = Math.max(retryAfter, row.retry, 1);
  }
  return retryAfter ? {ok: false, retryAfter} : {ok: true};
}

const hasSignatureField = (definition: unknown, fieldId: string) => {
  const fields = (definition as {fields?: unknown} | null)?.fields;
  return (
    Array.isArray(fields) &&
    fields.some(f => !!f && typeof f === 'object' && (f as {id?: unknown}).id === fieldId && (f as {type?: unknown}).type === 'signature')
  );
};

export const publicSignatureRoutes = new Hono().post('/signature', signatureBody, withDb, async c => {
  const input = c.req.valid('json');
  const secret = config.jwtSecret;
  if (!secret) return c.json(problem('not_configured', 'Signatures can’t be saved on this site yet.'), 503);
  c.header('Cache-Control', 'no-store');

  // The gate before any work: a page this site rendered for this form (pure HMAC, no lookup).
  const rendered = await readRenderHeader(secret, c.req.header(RENDER_HEADER), input.formId);
  if (rendered === null) {
    return c.json(problem('page_invalid', 'This form has expired. Reload the page and try again.'), 403);
  }

  const db = c.var.db;
  const limited = await hitSignatureLimits(db, await callerKey(secret, c.req.header('cf-connecting-ip')), input.formId);
  if (!limited.ok) {
    c.header('Retry-After', String(limited.retryAfter));
    return c.json(tooMany(limited.retryAfter), 429);
  }

  // Only a live form's signature field, in the version the respondent may be looking at: the
  // published one, or one of the two newest published in the last day.
  const form = await db.form.findUnique({
    where: {id: input.formId},
    select: {
      status: true,
      settings: true,
      publishedVersion: {select: {definition: true}},
      versions: {
        where: {publishedAt: {gt: new Date(Date.now() - PREVIOUS_VERSION_GRACE_MS)}},
        orderBy: {version: 'desc'},
        take: 2,
        select: {definition: true},
      },
    },
  });
  if (!form || form.status !== 'live' || !form.publishedVersion) {
    return c.json(problem('not_found', 'This form is no longer available.'), 404);
  }
  // A genuine token over a day old: the form offers a reload that keeps the answers.
  if (rendered === 'expired') {
    return c.json(problem('page_expired', SYSTEM_LABELS.pageExpired), 409);
  }
  const passwordHash = (form.settings as {passwordHash?: unknown} | null)?.passwordHash;
  if (typeof passwordHash === 'string' && passwordHash && !(await checkUnlockToken(secret, input.unlockToken, input.formId, passwordHash))) {
    return c.json(problem('locked', 'Enter the form password again, then submit.'), 401);
  }
  const definitions = [form.publishedVersion.definition, ...form.versions.map(v => v.definition)];
  if (!definitions.some(d => hasSignatureField(d, input.fieldId))) {
    return c.json(problem('not_found', 'This question is no longer on the form. Reload the page.'), 404);
  }

  const grant = await guarded(() =>
    // Private (personal data): shown only through GET /uploads/signatures/:responseId/:fieldId.
    createUpload(c.req.url, {name: SIGNATURE_NAME, contentType: SIGNATURE_TYPE, size: input.size, visibility: 'private'})
  );
  if (!grant.ok) {
    // The owner's storage problem is not the respondent's: one plain message. The code goes to
    // the log (no personal data), and the builder warns the owner (GET /builder/capabilities).
    console.warn(`[intelform] signature upload refused: ${grant.code}`);
    return c.json(problem('storage_failed', 'Your signature couldn’t be saved. Try again in a moment.'), grant.status === 503 ? 503 : 502);
  }
  const fileId = grant.data.file.id;
  const token = await signUploadToken(secret, {
    fileId,
    formId: input.formId,
    fieldId: input.fieldId,
    exp: Math.floor(Date.now() / 1000) + SIGNATURE_TOKEN_TTL_SECONDS,
  });
  return c.json({fileId, upload: grant.data.upload, token}, 201);
});
