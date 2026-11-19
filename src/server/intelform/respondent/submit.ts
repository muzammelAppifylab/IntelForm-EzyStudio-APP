import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {submitInput, type SubmitInput, type SubmitResponse} from '../../../lib/intelform/api-public';
import {formDefinition, type FormDefinition} from '../../../lib/intelform/form/definition';
import {SYSTEM_LABELS, type Labels} from '../../../lib/intelform/form/labels';
import {computeVisibility, emailDedupeKey, validateSubmission} from '../../../lib/intelform/form/logic';
import type {FormSettings} from '../../../lib/intelform/form/settings';
import {isSignatureDataUrl} from '../../../lib/intelform/form/types/registry';
import {buildSearchText, redirectWithAnswers} from './answers';
import {exactResponsesSql} from '../forms/counts';
import {fieldErrors, notFound, RespondentError} from './errors';
import {isClosed, type LoadedForm} from './load';
import {clearPublicSiteCache} from '../public-site/data';
import {clearPublicFormSlugs, loadPublishedBySlug} from './cache';
import {retryAfter, tooMany} from './rate-limit';
import type {RequestMeta} from './request-meta';
import {removeSignatures, storeSignatures} from './signatures';
import {checkUnlockToken, hashBrowserToken, readRenderToken} from './tokens';
import './validators';

/**
 * POST /site-api/public/forms/:slug/responses: the submit pipeline, in order. Built for bursts
 * (10k responses a minute on one form): an uncapped form's row is never written or locked, and a
 * capped form's submit is one statement too.
 *
 *  1. body: the app's 64 KB limit, a strict schema, 256 KB of answers without signatures
 *  2. the published form from the Site Cache (respondent/cache.ts); live and close date
 *     (closed: a retry of a fill that was saved still answers success, one read)
 *  3. the gate, ONE statement: rate limits (300 a minute per IP per form, for a school or office
 *     behind one address; 10 a minute per browser token per form) and, read exactly by primary
 *     key, the password hash (token check), the cap and its exact count, "this fill is saved"
 *  4. honeypot + minimum fill time (a fake 200 on a hit); a render token over 24 h old: reload
 *  5. validateSubmission against the version the browser rendered (+ the one-per-email answer)
 *  6. this fill already saved: answer success again; one per browser and one per email
 *     (pre-checks, one read when the form has either); then signature uploads (PNG only)
 *  7. the insert, ONE autocommit statement, queuing the notify work in intelform_notify_queue in
 *     the same statement. A capped form's statement targets its form_caps row (see
 *     cappedInsertSql). The unique (form_id, submission_id) index makes a retried fill a no-op;
 *     the unique email_key catches a repeated address.
 *  8. after commit: only cache clears when the cap closed the form. No job is sent from here:
 *     a job drains intelform_notify_queue once a minute (the platform takes 10 new jobs a
 *     minute, so one job per response would be refused at any real volume).
 *  9. reply { ok, redirectUrl? }
 *
 * Database round trips (a cached form): 1 the gate; 2 the duplicate pre-checks (only with one per
 * browser / email); 3 the insert. A cache miss adds the form read. The submit trusts the cached
 * shape only for what the insert statement re-checks or what can't let a wrong response in.
 */

/** Per IP per form per minute: high, so a whole class behind one address can respond. */
export const SUBMIT_IP_LIMIT = 300;
/** Per browser token per form per minute. */
export const SUBMIT_BROWSER_LIMIT = 10;
const RATE_WINDOW = 60;
const RATE_MESSAGE = 'You sent several responses in a row. Wait a minute and try again.';
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

/**
 * One per browser (soft limit) and one per email (a pre-check; the unique index is exact): ONE
 * statement, run only when the form has either setting.
 */
async function dupes(db: Pick<PrismaClient, '$queryRaw'>, form: LoadedForm, browserHash: string | null, emailKey: string | null): Promise<{seen: boolean; taken: boolean}> {
  const byBrowser = form.settings.onePerBrowser && browserHash ? browserHash : null;
  const byEmail = emailKey && form.settings.onePerEmailFieldId ? emailKey : null;
  if (!byBrowser && !byEmail) return {seen: false, taken: false};
  const rows = await db.$queryRaw<{seen: boolean; taken: boolean}[]>`
    SELECT
      ${byBrowser ? Prisma.sql`EXISTS (SELECT 1 FROM responses WHERE form_id = ${form.id}::uuid AND browser_token = ${byBrowser})` : Prisma.sql`false`} AS seen,
      ${byEmail ? Prisma.sql`EXISTS (SELECT 1 FROM responses WHERE form_id = ${form.id}::uuid AND email_key = ${byEmail})` : Prisma.sql`false`} AS taken
  `;
  return {seen: !!rows[0]?.seen, taken: !!rows[0]?.taken};
}

/** The rate-limit keys of one submit: always the caller's IP; the browser token when sent. */
export function submitRateKeys(ipKey: string, formId: string, browserHash: string | null): {key: string; limit: number}[] {
  const keys = [{key: `respond:${ipKey}:${formId}`, limit: SUBMIT_IP_LIMIT}];
  if (browserHash) keys.push({key: `respond-b:${browserHash}:${formId}`, limit: SUBMIT_BROWSER_LIMIT});
  return keys;
}

/** What the gate statement read about the form, exactly, beside the rate-limit hits. */
export interface Gate {
  /** False: the form was deleted since it was loaded. */
  found: boolean;
  passwordHash: string | null;
  /** The cap in the form's settings now (null: none). */
  cap: number | null;
  /** The exact all-time responses, when the form has a cap (else 0). */
  responses: number;
  /** This fill (its submissionId) is already saved. */
  saved: boolean;
}

/**
 * The gate: ONE statement counts one hit on each rate-limit key (the same table and windows as
 * rate-limit.ts `hit`) and reads, by primary key, what the Site Cache leaves out of the form: its
 * password hash, its cap and (only with a cap) its exact count, and whether this fill is already
 * saved. Keys always come in the same order (IP, then browser), so two submits never lock them in
 * opposite order. Throws a 429 when any key is over its limit.
 */
export const gateSql = (keys: {key: string}[], formId: string, submissionId: string | null) => Prisma.sql`
  WITH rl AS (
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    SELECT k, date_bin(make_interval(secs => ${RATE_WINDOW}::int), now(), 'epoch'), ${RATE_WINDOW}::int, 1
    FROM (VALUES ${Prisma.join(keys.map(k => Prisma.sql`(${k.key}::text)`))}) AS v(k)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING key, count
  ),
  x AS (
    SELECT f.id IS NOT NULL AS found, f.settings->>'passwordHash' AS password_hash,
      CASE WHEN jsonb_typeof(f.settings->'responseCap') = 'number'
        THEN least(ceil((f.settings->>'responseCap')::numeric), 2147483647)::int END AS cap,
      CASE WHEN jsonb_typeof(f.settings->'responseCap') = 'number' THEN ${exactResponsesSql(Prisma.sql`f.id`)} ELSE 0 END AS responses,
      ${
        submissionId
          ? Prisma.sql`EXISTS (SELECT 1 FROM responses r WHERE r.form_id = ${formId}::uuid AND r.submission_id = ${submissionId})`
          : Prisma.sql`false`
      } AS saved
    FROM (SELECT 1) AS one LEFT JOIN forms f ON f.id = ${formId}::uuid
  )
  SELECT rl.key, rl.count, x.found, x.password_hash, x.cap, x.responses, x.saved FROM rl, x
`;

async function submitGate(db: Pick<PrismaClient, '$queryRaw'>, keys: {key: string; limit: number}[], formId: string, submissionId: string | null): Promise<Gate> {
  const rows = await db.$queryRaw<{key: string; count: number; found: boolean; password_hash: string | null; cap: number | null; responses: number; saved: boolean}[]>(
    gateSql(keys, formId, submissionId)
  );
  for (const k of keys) {
    const row = rows.find(r => r.key === k.key);
    if (row && Number(row.count) > k.limit) throw tooMany(retryAfter(RATE_WINDOW), RATE_MESSAGE);
  }
  const x = rows[0];
  return {
    found: !!x?.found,
    passwordHash: x?.password_hash || null,
    cap: x?.cap === null || x?.cap === undefined ? null : Number(x.cap),
    responses: Number(x?.responses ?? 0),
    saved: !!x?.saved,
  };
}

/** This fill (its submissionId) was already saved on this form. */
async function alreadySaved(db: Pick<PrismaClient, '$queryRaw'>, formId: string, submissionId: string | undefined): Promise<boolean> {
  if (!submissionId) return false;
  const rows = await db.$queryRaw<unknown[]>`
    SELECT 1 FROM responses WHERE form_id = ${formId}::uuid AND submission_id = ${submissionId} LIMIT 1
  `;
  return rows.length > 0;
}

/** The saved answers (as text) of this fill, or null when it isn't saved. */
async function savedAnswersText(db: Pick<PrismaClient, '$queryRaw'>, formId: string, submissionId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{answers: string}[]>`
    SELECT answers::text AS answers FROM responses WHERE form_id = ${formId}::uuid AND submission_id = ${submissionId} LIMIT 1
  `;
  return rows[0]?.answers ?? null;
}

/** What the insert writes; everything was validated and computed before. */
export interface InsertParams {
  formId: string;
  versionId: string;
  answersJson: string;
  startedAt: Date | null;
  durationMs: number | null;
  ttcJson: string | null;
  meta: RequestMeta;
  browserHash: string | null;
  search: string;
  emailKey: string | null;
  submissionId: string | null;
  /** Queue the notify work (notification, confirmation, webhook) in the same statement. */
  needsJobs: boolean;
  now: Date;
}

const closeAtOk = (now: Date) =>
  Prisma.sql`(intelform_try_timestamptz(forms.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(forms.settings->>'closeAt') > ${now})`;

/** The cap in a form's settings, as an int (NULL: none). */
const capSql = Prisma.sql`CASE WHEN jsonb_typeof(forms.settings->'responseCap') = 'number'
  THEN least(ceil((forms.settings->>'responseCap')::numeric), 2147483647)::int END`;

/**
 * The `ins` and `q` CTEs: the response (from the one row of `source`, its form id in `id`) and
 * its notify queue entry. A retried fill hits the partial unique index and inserts nothing.
 * contact_* are filled by the responses_contact_fill trigger; form_counts and the hourly counts
 * by the responses_rollups trigger, form_caps.taken by the responses_form_caps trigger: never
 * written here.
 */
const insertCtes = (p: InsertParams, source: Prisma.Sql) => Prisma.sql`
  ins AS (
    INSERT INTO responses (form_id, form_version_id, answers, started_at, duration_ms, ttc, ip_hash, country, device, browser, browser_token, search_text, email_key, submission_id)
    SELECT src.id, ${p.versionId}::uuid, ${p.answersJson}::jsonb, ${p.startedAt}, ${p.durationMs}::int, ${p.ttcJson}::jsonb,
           ${p.meta.ipHash}, ${p.meta.country}, ${p.meta.device}, ${p.meta.browser}, ${p.browserHash}, ${p.search}, ${p.emailKey}, ${p.submissionId}
    FROM ${source} AS src
    ON CONFLICT (form_id, submission_id) WHERE submission_id IS NOT NULL DO NOTHING
    RETURNING id, submitted_at
  ),
  q AS (
    INSERT INTO intelform_notify_queue (response_id)
    SELECT id FROM ins WHERE ${p.needsJobs}::boolean
  )`;

/**
 * A form WITHOUT a response cap: a plain read of the form row (no lock, no write to it) re-checks
 * live and the close date in the same statement as the insert. If the form has gained a cap
 * since it was loaded, nothing is inserted and `capped` says to use cappedInsertSql. A form_caps
 * row left from a cap the owner removed is deleted here (a PK probe that finds nothing on an
 * uncapped form), so the count trigger never makes a burst queue on it.
 */
export const uncappedInsertSql = (p: InsertParams) => Prisma.sql`
  WITH f AS (
    -- coalesce: a settings object without the key gives NULL, and NOT NULL would insert nothing.
    SELECT forms.id, coalesce(jsonb_typeof(forms.settings->'responseCap') = 'number', false) AS capped
    FROM forms
    WHERE forms.id = ${p.formId}::uuid AND forms.status = 'live' AND ${closeAtOk(p.now)}
  ),
  uncapped AS (SELECT f.id FROM f WHERE NOT f.capped),
  leftover AS (
    DELETE FROM form_caps WHERE form_id IN (SELECT id FROM uncapped)
  ),
  ${insertCtes(p, Prisma.sql`uncapped`)}
  SELECT true AS passed, f.capped, ins.id::text AS id, ins.submitted_at, false AS closed_now, false AS replay
  FROM f LEFT JOIN ins ON true
`;

/**
 * A form WITH a response cap: ONE autocommit statement, no transaction and no lock on the form
 * row. Its target row is the form's form_caps row (`taken` = the exact response count, kept by
 * the responses triggers). The UPDATE `c` takes that row's lock; a parallel submit waits on it
 * and, in READ COMMITTED, re-checks `taken < cap` against the row's newest version
 * (EvalPlanQual) once the first commits, by which time the first one's insert trigger has
 * counted its response. So a cap of N under any burst takes exactly N.
 *
 * A retried fill never takes a slot: `c` skips it when the snapshot already holds it; if a
 * parallel copy committed after the snapshot, the unique index refuses this insert, the trigger
 * counts nothing, and `c` changed nothing but `cap`. The form is closed (status) only by the
 * submit whose insert filled the last slot.
 *
 * No form_caps row yet (the first capped submit since the cap was set): `has_row` is false and
 * nothing is inserted; capInitSql creates it, then this runs again.
 */
export const cappedInsertSql = (p: InsertParams) => Prisma.sql`
  WITH f AS (
    SELECT forms.id, ${capSql} AS cap
    FROM forms
    WHERE forms.id = ${p.formId}::uuid AND forms.status = 'live' AND ${closeAtOk(p.now)}
  ),
  dup AS (
    SELECT 1 FROM responses r WHERE r.form_id = ${p.formId}::uuid AND r.submission_id = ${p.submissionId}::text LIMIT 1
  ),
  c AS (
    UPDATE form_caps fc SET cap = f.cap
    FROM f
    WHERE fc.form_id = f.id AND f.cap IS NOT NULL AND fc.taken < f.cap AND NOT EXISTS (SELECT 1 FROM dup)
    RETURNING fc.form_id AS id, fc.taken, fc.cap
  ),
  ${insertCtes(p, Prisma.sql`c`)},
  closed AS (
    UPDATE forms SET status = 'closed', updated_at = now()
    FROM c
    WHERE forms.id = c.id AND c.taken + 1 >= c.cap AND EXISTS (SELECT 1 FROM ins)
    RETURNING forms.id
  )
  SELECT f.id IS NOT NULL AS passed, f.cap IS NOT NULL AS capped,
    EXISTS (SELECT 1 FROM form_caps WHERE form_id = ${p.formId}::uuid) AS has_row,
    EXISTS (SELECT 1 FROM c) AS took,
    ins.id::text AS id, ins.submitted_at,
    EXISTS (SELECT 1 FROM closed) AS closed_now,
    EXISTS (SELECT 1 FROM dup) AS replay
  FROM (SELECT 1) AS one LEFT JOIN f ON true LEFT JOIN ins ON true
`;

/**
 * Creates a capped form's form_caps row at the exact count (the sum of its form_counts shards).
 * From then on the responses triggers keep `taken` exact. Two first submits racing: one row.
 */
export const capInitSql = (formId: string) => Prisma.sql`
  INSERT INTO form_caps (form_id, cap, taken)
  SELECT forms.id, ${capSql}, ${exactResponsesSql(Prisma.sql`forms.id`)}
  FROM forms
  WHERE forms.id = ${formId}::uuid AND jsonb_typeof(forms.settings->'responseCap') = 'number'
  ON CONFLICT (form_id) DO NOTHING
  RETURNING form_id
`;

export interface InsertRow {
  passed: boolean;
  capped: boolean;
  id: string | null;
  submitted_at: Date | null;
  closed_now: boolean;
  replay: boolean;
}

export interface CappedRow extends InsertRow {
  has_row: boolean;
  took: boolean;
}

export type InsertOutcome =
  | {kind: 'saved'; id: string; closedNow: boolean}
  | {kind: 'duplicate'}
  | {kind: 'closed'}
  | {kind: 'capped'};

/** Reads the uncapped statement's one row (none: the form is not live or past its close date). */
export function insertOutcome(row: InsertRow | undefined, hasSubmissionId = true): InsertOutcome {
  if (!row) return {kind: 'closed'};
  if (row.id) return {kind: 'saved', id: row.id, closedNow: !!row.closed_now};
  if (row.replay) return {kind: 'duplicate'};
  if (!row.passed) return {kind: 'closed'};
  if (row.capped) return {kind: 'capped'};
  // The form passed and nothing was inserted: the (form_id, submission_id) index refused it.
  // Without a submission id nothing could have refused it: never answer success for a response
  // that was not saved.
  if (!hasSubmissionId) throw new Error('intelform submit: the insert saved nothing');
  return {kind: 'duplicate'};
}

/** What to do with the capped statement's row. */
export type CappedOutcome = InsertOutcome | {kind: 'init'} | {kind: 'uncapped'};

export function cappedOutcome(row: CappedRow | undefined, hasSubmissionId = true): CappedOutcome {
  if (!row) return {kind: 'closed'};
  if (row.id) return {kind: 'saved', id: row.id, closedNow: !!row.closed_now};
  if (row.replay) return {kind: 'duplicate'};
  if (!row.passed) return {kind: 'closed'};
  // The owner removed the cap since this submit looked.
  if (!row.capped) return {kind: 'uncapped'};
  if (!row.has_row) return {kind: 'init'};
  // No slot left (or the row went with a removed cap: the next submit sees it).
  if (!row.took) return {kind: 'closed'};
  // A slot was free and nothing was inserted: the unique index refused a parallel copy.
  if (!hasSubmissionId) throw new Error('intelform submit: the capped insert saved nothing');
  return {kind: 'duplicate'};
}

/**
 * Inserts on the path the form needs. A form that gained or lost its cap since this submit
 * looked switches path once; a capped form's first submit creates its form_caps row. At most
 * four statements, normally one.
 */
async function insertResponse(db: Pick<PrismaClient, '$queryRaw'>, p: InsertParams, capped: boolean): Promise<InsertOutcome> {
  const hasId = p.submissionId !== null;
  let path: 'capped' | 'uncapped' = capped ? 'capped' : 'uncapped';
  for (let step = 0; step < 4; step++) {
    if (path === 'uncapped') {
      const out = insertOutcome((await db.$queryRaw<InsertRow[]>(uncappedInsertSql(p)))[0], hasId);
      if (out.kind !== 'capped') return out;
      path = 'capped';
      continue;
    }
    const out = cappedOutcome((await db.$queryRaw<CappedRow[]>(cappedInsertSql(p)))[0], hasId);
    if (out.kind === 'init') await db.$queryRaw(capInitSql(p.formId));
    else if (out.kind === 'uncapped') path = 'uncapped';
    else return out.kind === 'capped' ? {kind: 'closed'} : out;
  }
  return {kind: 'closed'};
}

/** The success answer, the same for a new response and a retried fill. */
function reply(s: FormSettings, def: FormDefinition, answers: Record<string, unknown>, appendAnswers = s.redirectAppendAnswers): SubmitResponse {
  if (s.afterSubmit === 'redirect' && s.redirectUrl) {
    return {ok: true, redirectUrl: redirectWithAnswers(s.redirectUrl, def, answers, appendAnswers)};
  }
  return {ok: true};
}

/** A fill that was saved, retried after the form closed: the same success, from what was sent. */
function replyAgain(form: LoadedForm, answers: Record<string, unknown>, now: number): SubmitResponse {
  const again = validateSubmission(form.definition, answers, {context: {now: new Date(now), formVersion: form.version}, hidden: 'drop'});
  return again.ok ? reply(form.settings, form.definition, again.answers) : reply(form.settings, form.definition, {}, false);
}

export async function handleSubmit(ctx: SubmitContext, slug: string, bodyText: string): Promise<SubmitResponse> {
  const {db, secret} = ctx;
  const clock = ctx.now ?? Date.now;
  const labels = SYSTEM_LABELS;

  // 1. Body
  const input = parseSubmit(bodyText);
  assertAnswerSize(input.answers);
  const submissionId = input.submissionId ?? null;

  // 2. The published form, from the Site Cache (a miss: trip 1). Its status and close date
  // answer a closed form at once; the count, cap and password are read exactly below.
  const loaded = await loadPublishedBySlug(db, slug);
  if (loaded.kind !== 'form') throw notFound();
  const pub = loaded.published;
  const form = pub.form;
  if (isClosed(form, clock())) {
    // This fill may have been saved (and filled the cap) while its answer was lost: say so again.
    if (await alreadySaved(db, form.id, input.submissionId)) return replyAgain(form, input.answers, clock());
    throw closedError(form, labels);
  }
  const browserHash = input.browserToken ? await hashBrowserToken(secret, form.id, input.browserToken) : null;

  // 3. The gate (trip 2): rate limits, before anything that costs (uploads), with the password
  // hash, the cap and its exact count, and "this fill is saved", in one statement. Beside it,
  // the rendered version (a read only when it is the version just replaced).
  const [version, gate] = await Promise.all([
    versionFor(db, form, input.formVersionId),
    submitGate(db, submitRateKeys(ctx.ipKey, form.id, browserHash), form.id, submissionId),
  ]);
  if (!gate.found) throw notFound();
  const hash = gate.passwordHash;
  if (hash && !(await checkUnlockToken(secret, input.unlockToken, form.id, hash, clock()))) {
    throw new RespondentError(401, 'locked', 'Enter the form password again, then submit.');
  }
  if (gate.cap !== null && gate.responses >= gate.cap) {
    if (gate.saved) return replyAgain(form, input.answers, clock());
    throw closedError(form, labels);
  }

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

  // 6. This fill already saved (the gate); one per browser and one per email: one read, only
  // when the form has either (trip 3). Status and cap are not re-read: the insert checks them.
  if (gate.saved) return reply(form.settings, def, answers);
  const {seen, taken} = await dupes(db, form, browserHash, emailKey);
  if (seen) throw new RespondentError(409, 'already_responded', labels.alreadyResponded);
  const fieldId = form.settings.onePerEmailFieldId;
  if (taken && fieldId) throw emailTakenError(fieldId, labels);

  // Signatures were uploaded by the browser; claim them (token, PNG check) → {fileId}.
  const stored = await storeSignatures(ctx.requestUrl, form.id, def, answers, labels);

  // 7. The insert (one statement): live, close date and cap re-checked in the database, never in code.
  const meta = await ctx.meta();
  const startedAt =
    input.startedAt && input.startedAt <= now.getTime() && now.getTime() - input.startedAt < MAX_STARTED_AGO_MS ? new Date(input.startedAt) : null;
  const ttc = cleanTtc(input.ttc, answers);
  const params: InsertParams = {
    formId: form.id,
    versionId: input.formVersionId,
    answersJson: JSON.stringify(answers),
    startedAt,
    durationMs: startedAt ? Math.min(now.getTime() - startedAt.getTime(), 2_147_483_647) : null,
    ttcJson: ttc ? JSON.stringify(ttc) : null,
    meta,
    browserHash,
    search: buildSearchText(def.fields, answers),
    emailKey,
    submissionId,
    needsJobs: pub.needsJobs,
    now,
  };

  let out: InsertOutcome;
  try {
    out = await insertResponse(db, params, gate.cap !== null);
  } catch (err) {
    // The same address committed since the pre-check (maybe by this very fill, retried in
    // parallel), or a lost answer from the database (the write may have landed). If this fill
    // is saved, it's a success; only the files the saved response doesn't hold are removed.
    const kept = submissionId ? await savedAnswersText(db, form.id, submissionId).catch(() => null) : null;
    if (kept !== null) {
      await removeSignatures(ctx.requestUrl, stored.filter(id => !kept.includes(id)));
      return reply(form.settings, def, answers);
    }
    await removeSignatures(ctx.requestUrl, stored);
    if (emailKey && fieldId && isEmailKeyViolation(err)) throw emailTakenError(fieldId, labels);
    throw err;
  }
  if (out.kind !== 'saved') {
    // Nothing was saved by this request: the files it claimed belong to nothing.
    await removeSignatures(ctx.requestUrl, stored);
    if (out.kind === 'duplicate') return reply(form.settings, def, answers);
    throw closedError(form, labels);
  }

  // 8. After commit. A response that reached the cap closed the form: the public forms list and
  // this form's cached page must stop offering it. The notify work is already queued.
  if (out.closedNow) await Promise.all([clearPublicSiteCache(), clearPublicFormSlugs(form.slug)]).catch(() => undefined);

  // 9. Reply
  return reply(form.settings, def, answers);
}
