import type {PrismaClient} from '../../../generated/prisma/client';
import {submitInput, type SubmitInput, type SubmitResponse} from '../../../lib/intelform/api-public';
import {formDefinition, type FormDefinition} from '../../../lib/intelform/form/definition';
import {SYSTEM_LABELS, type Labels} from '../../../lib/intelform/form/labels';
import {computeVisibility, emailDedupeKey, validateSubmission} from '../../../lib/intelform/form/logic';
import {isSignatureDataUrl} from '../../../lib/intelform/form/types/registry';
import {buildSearchText, redirectWithAnswers} from './answers';
import {fieldErrors, RespondentError} from './errors';
import {isClosed, parseSettings, requireForm, type LoadedForm} from './load';
import {queueResponseJobs} from '../notify';
import {clearPublicSiteCache} from '../public-site/data';
import {clearPublicFormCache} from './cache';
import {rateLimit} from './rate-limit';
import type {RequestMeta} from './request-meta';
import {removeSignatures, storeSignatures} from './signatures';
import {checkUnlockToken, hashBrowserToken, readRenderToken} from './tokens';
import './validators';

/**
 * POST /site-api/public/forms/:slug/responses: the submit pipeline, in order:
 *
 *  1. body: the app's 64 KB limit, a strict schema, 256 KB of answers without signatures
 *  2. live, close date, cap, password token
 *  3. rate limit: 10 per minute per IP per form (intelform_rate_limits)
 *  4. honeypot + minimum fill time (a fake 200 on a hit); a render token over 24 h old: reload
 *  5. validateSubmission against the version the browser rendered (+ the one-per-email answer)
 *  6. one per browser
 *  7. one per email (pre-check), then signature uploads (PNG only)
 *  8. one statement: counter, close date and cap (a conditional UPDATE locks the form row),
 *     auto-close at the cap, insert (the unique email_key catches a repeat)
 *
 * About 4 database round trips: the form;  the rate limit beside the version; one per
 * browser and one per email together; the insert statement.
 *  9. after commit: the notify job (intelform-response-notify {responseId}: notification,
 *     confirmation and webhook; ../notify), never inside the transaction
 * 10. reply { ok, redirectUrl? }
 */

export const SUBMIT_RATE_LIMIT = 10;
/** Anything faster than this from render to submit is a bot. */
export const MIN_FILL_MS = 2000;
export const MAX_ANSWERS_BYTES = 256 * 1024;
const MAX_STARTED_AGO_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TTC_MS = 24 * 60 * 60 * 1000;
/** A browser that rendered the version just replaced may still submit it for this long. */
export const PREVIOUS_VERSION_GRACE_MS = 24 * 60 * 60 * 1000;

export type SubmitDb = Pick<PrismaClient, '$queryRaw' | 'intelformSettings'>;

export interface SubmitContext {
  db: SubmitDb;
  /** The site secret (crypto.ts requireSecret). */
  secret: string;
  /** The current request's URL: the platform's address for jobs and files. */
  requestUrl: string;
  /** Keyed rate-limit key part for the caller (crypto.ts ipKeyFor). */
  ipKey: string;
  /** Hashed IP, country, device, browser (request-meta.ts). */
  meta: () => Promise<RequestMeta>;
  now?: () => number;
}

const closedError = (form: Pick<LoadedForm, 'settings'>, labels: Labels) =>
  new RespondentError(403, 'form_closed', form.settings.closedMessage || labels.closed);

/** Parses the body text against the submit schema. */
export function parseSubmit(text: string): SubmitInput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RespondentError(400, 'invalid_json', 'The request body must be JSON.');
  }
  const parsed = submitInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_form');
      (fields[key] ??= []).push(issue.message);
    }
    throw new RespondentError(400, 'invalid_request', 'This response could not be read. Reload the form and try again.', fields);
  }
  return parsed.data;
}

/** Answers without signature data URLs must stay under 256 KB. */
export function assertAnswerSize(answers: Record<string, unknown>): void {
  const withoutSignatures = JSON.stringify(answers, (_k, v) => (isSignatureDataUrl(v) ? '' : v));
  if (new TextEncoder().encode(withoutSignatures).length > MAX_ANSWERS_BYTES) {
    throw new RespondentError(413, 'payload_too_large', 'That response is too large. Shorten the longest answers and try again.');
  }
}

/**
 * The current published version, or the one it replaced if that happened under 24 hours ago
 * (a respondent mid-way through when the owner republished). Anything older: reload.
 */
async function versionFor(db: Pick<PrismaClient, '$queryRaw'>, form: LoadedForm, versionId: string): Promise<{definition: FormDefinition; version: number}> {
  if (versionId === form.versionId) return {definition: form.definition, version: form.version};
  const rows = await db.$queryRaw<{definition: unknown; version: number}[]>`
    SELECT prev.definition, prev.version
    FROM form_versions prev
    JOIN form_versions cur ON cur.id = ${form.versionId}::uuid AND cur.form_id = prev.form_id
    WHERE prev.id = ${versionId}::uuid AND prev.form_id = ${form.id}::uuid
      AND prev.version = cur.version - 1
      AND cur.published_at > now() - make_interval(secs => ${PREVIOUS_VERSION_GRACE_MS / 1000}::int)
  `;
  const row = rows[0];
  const def = row && formDefinition.safeParse(row.definition);
  if (!row || !def || !def.success) {
    throw new RespondentError(409, 'version_unknown', 'This form has changed. Reload the page to see the latest version.');
  }
  return {definition: def.data, version: Number(row.version)};
}

export function cleanTtc(ttc: Record<string, number> | undefined, answers: Record<string, unknown>): Record<string, number> | null {
  if (!ttc) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(ttc)) {
    if (Object.hasOwn(answers, k) && Number.isFinite(v) && v >= 0) out[k] = Math.min(Math.round(v), MAX_TTC_MS);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * One response per email needs an answer to check. Missing (left blank, hidden by logic, or the
 * question is gone) is a rejection, not a free pass. Returns the dedupe key, or null when off.
 */
export function onePerEmailKey(form: Pick<LoadedForm, 'id' | 'settings'>, def: FormDefinition, answers: Record<string, unknown>, labels: Labels): string | null {
  const s = form.settings;
  if (!s.onePerEmail) return null;
  const fieldId = s.onePerEmailFieldId;
  const email = fieldId ? answers[fieldId] : undefined;
  if (typeof email === 'string' && email.trim()) return emailDedupeKey(email).slice(0, 254);
  const field = fieldId ? def.fields.find(f => f.id === fieldId && f.type === 'email') : undefined;
  if (field && computeVisibility(def, answers).fields.has(field.id)) {
    throw new RespondentError(422, 'validation_failed', labels.errorSummary, {[field.id]: [labels.emailNeeded]});
  }
  // The respondent can't fix this one: no field error, so the form shows the message.
  console.warn(`intelform submit: one response per email has no shown email question (form ${form.id})`);
  throw new RespondentError(422, 'validation_failed', labels.cannotAccept);
}

const emailTakenError = (fieldId: string, labels: Labels) =>
  new RespondentError(422, 'validation_failed', labels.alreadyResponded, {[fieldId]: [labels.alreadyResponded]});

/** A unique violation of responses_email_key, through Prisma or the platform's db socket. */
export function isEmailKeyViolation(err: unknown): boolean {
  const e = err as {code?: string; meta?: {code?: string; target?: unknown; message?: string}; originalCode?: string; message?: string} | null;
  if (!e) return false;
  const unique = e.code === 'P2002' || e.code === '23505' || e.meta?.code === '23505' || e.originalCode === '23505';
  const text = `${e.message ?? ''} ${e.meta?.message ?? ''} ${JSON.stringify(e.meta?.target ?? '')}`;
  return unique && /email_key/.test(text);
}

/** One per email: the address was already used on this form (a pre-check; the unique index is exact). */
function emailDupe(db: Pick<PrismaClient, '$queryRaw'>, form: LoadedForm, emailKey: string | null): Promise<unknown[]> {
  const fieldId = form.settings.onePerEmailFieldId;
  return emailKey && fieldId
    ? db.$queryRaw<unknown[]>`SELECT 1 FROM responses WHERE form_id = ${form.id}::uuid AND email_key = ${emailKey} LIMIT 1`
    : Promise.resolve([]);
}

/** One per browser (soft limit): a response with this browser's token. */
function browserDupe(db: Pick<PrismaClient, '$queryRaw'>, form: LoadedForm, browserHash: string | null): Promise<unknown[]> {
  return form.settings.onePerBrowser && browserHash
    ? db.$queryRaw<unknown[]>`SELECT 1 FROM responses WHERE form_id = ${form.id}::uuid AND browser_token = ${browserHash} LIMIT 1`
    : Promise.resolve([]);
}

export async function handleSubmit(ctx: SubmitContext, slug: string, bodyText: string): Promise<SubmitResponse> {
  const {db, secret} = ctx;
  const clock = ctx.now ?? Date.now;
  const labels = SYSTEM_LABELS;

  // 1. Body
  const input = parseSubmit(bodyText);
  assertAnswerSize(input.answers);

  // 2. Form state (trip 1)
  const form = await requireForm(db, slug);
  if (isClosed(form, clock())) throw closedError(form, labels);
  const hash = form.settings.passwordHash;
  if (hash && !(await checkUnlockToken(secret, input.unlockToken, form.id, hash, clock()))) {
    throw new RespondentError(401, 'locked', 'Enter the form password again, then submit.');
  }

  // 3. Rate limit, before anything that costs (uploads), beside the rendered version (trip 2)
  const [, version] = await Promise.all([
    rateLimit(db, `respond:${ctx.ipKey}:${form.id}`, SUBMIT_RATE_LIMIT, 60, 'You sent several responses in a row. Wait a minute and try again.'),
    versionFor(db, form, input.formVersionId),
  ]);

  // 4. Honeypot and minimum time: pretend it worked, keep nothing.
  const renderedAt = await readRenderToken(secret, input.renderToken, form.id, clock());
  if ((input.hp ?? '') !== '' || renderedAt === null || (renderedAt !== 'expired' && clock() - renderedAt < MIN_FILL_MS)) {
    console.info(`intelform submit: dropped by spam checks (form ${form.id})`);
    return {ok: true};
  }
  // A genuine token, but the page has been open for over a day: no fake success (a real person
  // would lose their answers). The form offers a reload that keeps them and fetches a new token.
  if (renderedAt === 'expired') throw new RespondentError(409, 'page_expired', labels.pageExpired);

  // 5. Validate against the version that was rendered (consent stamped with server time and version)
  const def = version.definition;
  const now = new Date(clock());
  const result = validateSubmission(def, input.answers, {context: {now, formVersion: version.version}, hidden: 'reject'});
  if (!result.ok) throw new RespondentError(422, 'validation_failed', labels.errorSummary, fieldErrors(result.errors));
  const answers = result.answers;
  const emailKey = onePerEmailKey(form, def, answers, labels);
  const browserHash = input.browserToken ? await hashBrowserToken(secret, form.id, input.browserToken) : null;

  // 6–7. One per browser and one per email, together (trip 3). Status and cap are not
  // re-read: the insert statement below checks them exactly.
  const [seen, dupes] = await Promise.all([
    browserDupe(db, form, browserHash),
    emailDupe(db, form, emailKey),
  ]);
  if (seen.length) throw new RespondentError(409, 'already_responded', labels.alreadyResponded);
  const fieldId = form.settings.onePerEmailFieldId;
  if (dupes.length && fieldId) throw emailTakenError(fieldId, labels);

  // Signatures were uploaded by the browser; claim them (token, PNG check) → {fileId}.
  const stored = await storeSignatures(ctx.requestUrl, form.id, def, answers, labels);

  // 8. ONE statement (trip 4, atomic without an interactive transaction): the counter UPDATE
  // locks the form row and re-checks live, close date and cap exactly; it closes the form when
  // this response reaches the cap; the insert runs only if it passed. A unique violation
  // (responses_email_key: the same address committed since the pre-check) undoes all of it.
  const meta = await ctx.meta();
  const startedAt =
    input.startedAt && input.startedAt <= now.getTime() && now.getTime() - input.startedAt < MAX_STARTED_AGO_MS ? new Date(input.startedAt) : null;
  const durationMs = startedAt ? Math.min(now.getTime() - startedAt.getTime(), 2_147_483_647) : null;
  const ttc = cleanTtc(input.ttc, answers);
  const search = buildSearchText(def.fields, answers);
  const answersJson = JSON.stringify(answers);
  const ttcJson = ttc ? JSON.stringify(ttc) : null;

  let saved: {id: string; submittedAt: Date; settings: ReturnType<typeof parseSettings>; closedNow: boolean};
  try {
    // contact_* are filled by the responses_contact_fill trigger: never written here.
    const rows = await db.$queryRaw<{id: string; submitted_at: Date; settings: unknown; status: string}[]>`
      WITH f AS (
        UPDATE forms SET
          response_count = response_count + 1,
          last_response_at = now(),
          status = CASE WHEN jsonb_typeof(settings->'responseCap') = 'number'
                         AND response_count + 1 >= (settings->>'responseCap')::numeric THEN 'closed' ELSE status END,
          updated_at = CASE WHEN jsonb_typeof(settings->'responseCap') = 'number'
                         AND response_count + 1 >= (settings->>'responseCap')::numeric THEN now() ELSE updated_at END
        WHERE id = ${form.id}::uuid AND status = 'live'
          AND (intelform_try_timestamptz(settings->>'closeAt') IS NULL OR intelform_try_timestamptz(settings->>'closeAt') > ${now})
          AND (jsonb_typeof(settings->'responseCap') IS DISTINCT FROM 'number' OR response_count < (settings->>'responseCap')::numeric)
        RETURNING id, settings, status
      ),
      ins AS (
        INSERT INTO responses (form_id, form_version_id, answers, started_at, duration_ms, ttc, ip_hash, country, device, browser, browser_token, search_text, email_key)
        SELECT f.id, ${input.formVersionId}::uuid, ${answersJson}::jsonb, ${startedAt}, ${durationMs}::int, ${ttcJson}::jsonb,
               ${meta.ipHash}, ${meta.country}, ${meta.device}, ${meta.browser}, ${browserHash}, ${search}, ${emailKey}
        FROM f
        RETURNING id, submitted_at
      )
      SELECT ins.id::text AS id, ins.submitted_at, f.settings, f.status FROM ins, f
    `;
    const row = rows[0];
    if (!row) throw closedError(form, labels);
    saved = {id: row.id, submittedAt: row.submitted_at, settings: parseSettings(row.settings), closedNow: row.status === 'closed'};
  } catch (err) {
    await removeSignatures(ctx.requestUrl, stored);
    if (emailKey && fieldId && isEmailKeyViolation(err)) throw emailTakenError(fieldId, labels);
    throw err;
  }

  // 9. Later work, after commit. A response that reached the cap closed the form: the public
  // forms list and the cached form page must stop offering it.
  if (saved.closedNow) await Promise.all([clearPublicSiteCache(), clearPublicFormCache()]).catch(() => undefined);
  await queueResponseJobs(ctx.requestUrl, {formId: form.id, formTitle: form.title, responseId: saved.id, settings: saved.settings});

  // 10. Reply
  const s = form.settings;
  if (s.afterSubmit === 'redirect' && s.redirectUrl) {
    return {ok: true, redirectUrl: redirectWithAnswers(s.redirectUrl, def, answers, s.redirectAppendAnswers)};
  }
  return {ok: true};
}
