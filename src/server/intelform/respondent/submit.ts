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
import {wakeNotifyJob} from '../notify/wake';
import {clearPublicSiteCache} from '../public-site/data';
import {clearPublicFormSlugs, loadPublishedBySlug} from './cache';
import {retryAfter, tooMany} from './rate-limit';
import type {RequestMeta} from './request-meta';
import {removeSignatures, storeSignatures} from './signatures';
import {checkUnlockToken, hashBrowserToken, LOCAL_IP_KEY, readSubmitToken} from './tokens';
import {FIXED_LIMITS, SITE_LIMITS} from '../../../lib/intelform/spam';
import type {AbuseEvent} from '../abuse/alert';
import {autoBlock} from '../abuse/blocks';
import {reportAbusiveIp} from '../abuse/report';
import {DONE_SECONDS, doneKey} from '../notify/markers';
import './validators';

/**
 * POST /site-api/public/forms/:slug/responses: the submit pipeline, in order. Built for bursts
 * (10k responses a minute on one form): an uncapped form's row is never written or locked, and a
 * capped form's submit is one statement too.
 *
 *  1. body: the app's 64 KB limit, a strict schema, 256 KB of answers without signatures
 *  2. the published form from the Site Cache (respondent/cache.ts); live and close date
 *     (closed: a retry of a fill that was saved still answers success, one read)
 *  3. the gate, ONE statement (spam protection, src/lib/intelform/spam.ts): the block list (a
 *     primary-key probe), the per-address limits (default 5 an hour and 20 a day per form; 10 a
 *     minute per browser token), then, only for an address within its limits, the form's limit
 *     (default 60 a minute) and the site's (default 300 a minute); a refusal over a per-address
 *     limit counts a strike. Beside them, read exactly by primary key: the password hash, the
 *     cap and its exact count, "this fill is saved" and "this page load already saved a response"
 *  4. honeypot + minimum fill time against THIS page load (a fake 200 on a hit); a render token
 *     over 24 h old, for another address block, or already used by another fill: reload
 *  5. validateSubmission against the version the browser rendered (+ the one-per-email answer)
 *  6. this fill already saved: answer success again; one per browser and one per email
 *     (pre-checks, one read when the form has either); then signature uploads (PNG only)
 *  7. the insert, ONE autocommit statement, claiming the render token (one response per page load),
 *     queuing the notify work in intelform_notify_queue and, for a form that sends confirmations,
 *     counting this address's confirmations (over 3 an hour: that response gets none), in the same
 *     statement. A capped form's statement targets its form_caps row (see
 *     cappedInsertSql). The unique (form_id, submission_id) index makes a retried fill a no-op;
 *     the unique email_key catches a repeated address.
 *  8. after commit: cache clears when the cap closed the form, and the wake-up of the notify job
 *     (notify/wake.ts): ONE keyed job a minute drains intelform_notify_queue, however many
 *     responses arrive (one job per response would be refused at any real volume).
 *  9. reply { ok, redirectUrl? }
 *
 * Database round trips (a cached form): 1 the gate; 2 the duplicate pre-checks (only with one per
 * browser / email); 3 the insert. A cache miss adds the form read. The submit trusts the cached
 * shape only for what the insert statement re-checks or what can't let a wrong response in.
 */

/** Per browser token per form per minute. */
export const SUBMIT_BROWSER_LIMIT = 10;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const IP_MESSAGE = 'You sent several responses from this network in a short time. Try again later.';
const BUSY_MESSAGE = 'This form is getting a lot of responses right now. Wait a minute and try again.';
const BLOCKED_MESSAGE = 'Responses from your network are paused for a while. Try again later.';
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
  /** The caller's address block (crypto.ts ipBlockOf), kept with an automatic block; null when unknown. */
  ipBlock?: string | null;
  /** Spam protection's log and owner alert, run after the answer (the route defers it). */
  abuse?: (event: AbuseEvent) => void;
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

/** One rate-limit key of the gate: its window and its limit. */
export interface GateKey {
  key: string;
  window: number;
  limit: number;
}

/** The limits of one submit, from the form's settings (src/lib/intelform/spam.ts). */
export function gateKeys(
  ipKey: string,
  formId: string,
  browserHash: string | null,
  s: Pick<FormSettings, 'spamIpPerHour' | 'spamIpPerDay' | 'spamFormPerMinute'>
): {perAddress: GateKey[]; perForm: GateKey; perSite: Omit<GateKey, 'limit'>; strike: string} {
  const perAddress: GateKey[] = [
    {key: `respond-h:${ipKey}:${formId}`, window: HOUR, limit: s.spamIpPerHour},
    {key: `respond-d:${ipKey}:${formId}`, window: DAY, limit: s.spamIpPerDay},
  ];
  if (browserHash) perAddress.push({key: `respond-b:${browserHash}:${formId}`, window: MINUTE, limit: SUBMIT_BROWSER_LIMIT});
  return {
    perAddress,
    perForm: {key: `respond-f:${formId}`, window: MINUTE, limit: s.spamFormPerMinute},
    perSite: {key: 'respond-site', window: MINUTE},
    strike: `strike:${ipKey}`,
  };
}

/** The done-marker key that says a page load (its render token) saved a response. */
export const tokenKey = (formId: string, tokenId: string) => `tok:${formId}:${tokenId}`;
/** A used token is remembered past its 24 hours of life. */
const TOKEN_KEEP_SECONDS = 25 * 3600;

/** What the gate statement read, beside the rate-limit hits. */
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
  /** This page load (its render token) already saved a response. */
  tokenUsed: boolean;
}

export interface GateRow {
  blocked_until: Date | null;
  ip_over: boolean | null;
  counts: Record<string, number> | string | null;
  site_limit: number | null;
  strikes: number | null;
  found: boolean;
  password_hash: string | null;
  cap: number | null;
  responses: number;
  saved: boolean;
  token_used: boolean;
}

const windowStart = (w: Prisma.Sql) => Prisma.sql`date_bin(make_interval(secs => ${w}), now(), 'epoch')`;

/**
 * The gate: ONE statement. In order:
 *   blk     the block list, one primary-key probe: a blocked address writes nothing at all;
 *   ip      one hit on each per-address key (the same table and windows as rate-limit.ts `hit`);
 *   wide    only when every per-address count is within its limit: one hit on the form's and the
 *           site's per-minute keys, so one address hammering a form can't use up everyone's share;
 *   strike  only when a per-address count is over: one strike for the address (an hour), which
 *           blocks it after FIXED_LIMITS.strikesBeforeBlock (./submit.ts, ../abuse/blocks.ts);
 * and, by primary key, what the Site Cache leaves out of the form: its password hash, its cap and
 * (only with a cap) its exact count, whether this fill is saved and whether this page load already
 * saved a response. The site's limit comes from intelform_settings (a primary-key read). Keys
 * always come in the same order (address, then form, then site), so two submits never lock them in
 * opposite order.
 */
export const gateSql = (
  ipKey: string,
  keys: ReturnType<typeof gateKeys>,
  formId: string,
  submissionId: string | null,
  usedKey: string | null
) => {
  const ipValues = Prisma.join(keys.perAddress.map(k => Prisma.sql`(${k.key}::text, ${k.window}::int, ${k.limit}::int)`));
  return Prisma.sql`
  WITH blk AS (
    SELECT expires_at FROM intelform_blocked_ips WHERE ip_key = ${ipKey} AND expires_at > now()
  ),
  lim AS (SELECT * FROM (VALUES ${ipValues}) AS v(k, w, lim)),
  ip AS (
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    SELECT lim.k, ${windowStart(Prisma.sql`lim.w`)}, lim.w, 1 FROM lim
    WHERE NOT EXISTS (SELECT 1 FROM blk)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING key, count
  ),
  ip_over AS (
    SELECT coalesce(bool_or(ip.count > lim.lim), false) AS over FROM ip JOIN lim ON lim.k = ip.key
  ),
  site AS (
    SELECT CASE WHEN jsonb_typeof(s.spam_limits->'sitePerMinute') = 'number'
      THEN least(greatest(ceil((s.spam_limits->>'sitePerMinute')::numeric)::int, ${SITE_LIMITS.sitePerMinute.min}::int), ${SITE_LIMITS.sitePerMinute.max}::int)
      ELSE ${SITE_LIMITS.sitePerMinute.default}::int END AS lim
    FROM (SELECT 1) AS one LEFT JOIN intelform_settings s ON s.id = 1
  ),
  wide AS (
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    SELECT v.k, ${windowStart(Prisma.sql`${MINUTE}::int`)}, ${MINUTE}::int, 1
    FROM (VALUES (${keys.perForm.key}::text, 1), (${keys.perSite.key}::text, 2)) AS v(k, o)
    WHERE NOT EXISTS (SELECT 1 FROM blk) AND NOT (SELECT over FROM ip_over)
    ORDER BY v.o
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING key, count
  ),
  strike AS (
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    SELECT ${keys.strike}, ${windowStart(Prisma.sql`${HOUR}::int`)}, ${HOUR}::int, 1
    WHERE (SELECT over FROM ip_over)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count
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
      } AS saved,
      ${
        usedKey
          ? Prisma.sql`EXISTS (SELECT 1 FROM intelform_done_markers m WHERE m.key = ${usedKey} AND m.expires_at > now())`
          : Prisma.sql`false`
      } AS token_used
    FROM (SELECT 1) AS one LEFT JOIN forms f ON f.id = ${formId}::uuid
  )
  SELECT (SELECT max(expires_at) FROM blk) AS blocked_until,
    (SELECT over FROM ip_over) AS ip_over,
    (SELECT jsonb_object_agg(c.key, c.count) FROM (SELECT key, count FROM ip UNION ALL SELECT key, count FROM wide) AS c) AS counts,
    (SELECT lim FROM site) AS site_limit,
    (SELECT count FROM strike) AS strikes,
    x.found, x.password_hash, x.cap, x.responses, x.saved, x.token_used
  FROM x
`;
};

/** A refused submit: the 429 to answer, and what spam protection does about it. */
export type GateRefusal =
  | {kind: 'blocked'; until: Date}
  | {kind: 'address'; window: number; strikes: number}
  | {kind: 'form' | 'site'};

/** Reads the gate's row: the refusal, if any (the block first, then the address, the form, the site). */
export function gateRefusal(row: GateRow | undefined, keys: ReturnType<typeof gateKeys>): GateRefusal | null {
  if (!row) return null;
  if (row.blocked_until) return {kind: 'blocked', until: new Date(row.blocked_until)};
  const counts = (typeof row.counts === 'string' ? JSON.parse(row.counts) : row.counts ?? {}) as Record<string, number>;
  const over = (k: {key: string; limit: number}) => Number(counts[k.key] ?? 0) > k.limit;
  const address = keys.perAddress.filter(over);
  if (address.length) {
    return {kind: 'address', window: Math.max(...address.map(k => k.window)), strikes: Number(row.strikes ?? 0)};
  }
  if (over(keys.perForm)) return {kind: 'form'};
  if (row.site_limit !== null && Number(counts[keys.perSite.key] ?? 0) > Number(row.site_limit)) return {kind: 'site'};
  return null;
}

function gateOf(row: GateRow | undefined): Gate {
  return {
    found: !!row?.found,
    passwordHash: row?.password_hash || null,
    cap: row?.cap === null || row?.cap === undefined ? null : Number(row.cap),
    responses: Number(row?.responses ?? 0),
    saved: !!row?.saved,
    tokenUsed: !!row?.token_used,
  };
}

/**
 * Runs the gate. A refusal answers 429; on the way it blocks an address that keeps going over
 * its limits (escalating, ../abuse/blocks.ts) and tells spam protection's log and owner alert.
 */
async function submitGate(
  ctx: SubmitContext,
  form: Pick<LoadedForm, 'id' | 'settings'>,
  browserHash: string | null,
  submissionId: string | null,
  usedKey: string | null,
  now: number
): Promise<Gate> {
  const keys = gateKeys(ctx.ipKey, form.id, browserHash, form.settings);
  const rows = await ctx.db.$queryRaw<GateRow[]>(gateSql(ctx.ipKey, keys, form.id, submissionId, usedKey));
  const refused = gateRefusal(rows[0], keys);
  if (!refused) return gateOf(rows[0]);
  switch (refused.kind) {
    case 'blocked':
      throw tooMany(Math.max(1, Math.ceil((refused.until.getTime() - now) / 1000)), BLOCKED_MESSAGE);
    case 'address': {
      // Keeps going over: block the address (never "local", the address-less development caller).
      if (refused.strikes >= FIXED_LIMITS.strikesBeforeBlock && ctx.ipKey !== LOCAL_IP_KEY) {
        const block = await autoBlock(ctx.db, {ipKey: ctx.ipKey, ipBlock: ctx.ipBlock ?? null, formId: form.id, strikes: refused.strikes});
        if (block.fresh) {
          if (ctx.ipBlock) await reportAbusiveIp({ipBlock: ctx.ipBlock, reason: 'limits', count: refused.strikes}).catch(() => undefined);
          ctx.abuse?.({kind: 'blocked', formId: form.id, step: block.step, strikes: refused.strikes, until: block.until});
        }
        throw tooMany(Math.max(1, Math.ceil((block.until.getTime() - now) / 1000)), BLOCKED_MESSAGE);
      }
      throw tooMany(retryAfter(refused.window, now), IP_MESSAGE);
    }
    default:
      ctx.abuse?.({kind: 'limit', formId: form.id, scope: refused.kind});
      throw tooMany(retryAfter(MINUTE, now), BUSY_MESSAGE);
  }
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
  /** The done-marker that claims this page load (tokenKey): one response per render token. Null: none to claim. */
  usedKey?: string | null;
  /** The form sends confirmations: this address's confirmation count key (else null). */
  confirmIpKey?: string | null;
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
  want AS (SELECT ${p.usedKey ?? null}::text AS key),
  tok AS (
    INSERT INTO intelform_done_markers (key, expires_at)
    SELECT want.key, now() + make_interval(secs => ${TOKEN_KEEP_SECONDS}::int)
    FROM ${source} AS s0, want WHERE want.key IS NOT NULL
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  ),
  ins AS (
    INSERT INTO responses (form_id, form_version_id, answers, started_at, duration_ms, ttc, ip_hash, country, device, browser, browser_token, search_text, email_key, submission_id)
    SELECT src.id, ${p.versionId}::uuid, ${p.answersJson}::jsonb, ${p.startedAt}, ${p.durationMs}::int, ${p.ttcJson}::jsonb,
           ${p.meta.ipHash}, ${p.meta.country}, ${p.meta.device}, ${p.meta.browser}, ${p.browserHash}, ${p.search}, ${p.emailKey}, ${p.submissionId}
    FROM ${source} AS src
    WHERE NOT EXISTS (SELECT 1 FROM want WHERE want.key IS NOT NULL) OR EXISTS (SELECT 1 FROM tok)
    ON CONFLICT (form_id, submission_id) WHERE submission_id IS NOT NULL DO NOTHING
    RETURNING id, submitted_at
  ),
  q AS (
    INSERT INTO intelform_notify_queue (response_id)
    SELECT id FROM ins WHERE ${p.needsJobs}::boolean
  ),
  cip AS (
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    SELECT ${p.confirmIpKey ?? null}::text, ${windowStart(Prisma.sql`${HOUR}::int`)}, ${HOUR}::int, 1
    FROM ins WHERE ${p.confirmIpKey ?? null}::text IS NOT NULL
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count
  ),
  cipm AS (
    INSERT INTO intelform_done_markers (key, expires_at)
    SELECT ${doneKey('confirm-skip-ip', '')} || ins.id::text, now() + make_interval(secs => ${DONE_SECONDS}::int)
    FROM ins, cip WHERE cip.count > ${FIXED_LIMITS.confirmPerIpPerHour}::int
    ON CONFLICT (key) DO NOTHING
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
  SELECT true AS passed, f.capped, ins.id::text AS id, ins.submitted_at, false AS closed_now, false AS replay,
    EXISTS (SELECT 1 FROM tok) AS claimed
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
    EXISTS (SELECT 1 FROM dup) AS replay,
    EXISTS (SELECT 1 FROM tok) AS claimed
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
  /** This statement claimed the page load's render token (undefined: an older shape, treated as claimed). */
  claimed?: boolean;
}

export interface CappedRow extends InsertRow {
  has_row: boolean;
  took: boolean;
}

export type InsertOutcome =
  | {kind: 'saved'; id: string; closedNow: boolean}
  | {kind: 'duplicate'}
  | {kind: 'closed'}
  | {kind: 'capped'}
  /** Nothing saved because the page load's render token was taken (by this fill in parallel, or another). */
  | {kind: 'token'};

/** Reads the uncapped statement's one row (none: the form is not live or past its close date). */
export function insertOutcome(row: InsertRow | undefined, hasSubmissionId = true): InsertOutcome {
  if (!row) return {kind: 'closed'};
  if (row.id) return {kind: 'saved', id: row.id, closedNow: !!row.closed_now};
  if (row.replay) return {kind: 'duplicate'};
  if (!row.passed) return {kind: 'closed'};
  if (row.capped) return {kind: 'capped'};
  if (row.claimed === false) return {kind: 'token'};
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
  if (row.claimed === false) return {kind: 'token'};
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
  // One per browser without a browser token (a script that leaves it out) falls back to the
  // caller's address block: still a soft limit, but it can't be skipped by sending nothing.
  const browserHash = input.browserToken
    ? await hashBrowserToken(secret, form.id, input.browserToken)
    : form.settings.onePerBrowser
      ? await hashBrowserToken(secret, form.id, `address:${ctx.ipKey}`)
      : null;
  // The render token, checked in code (no query): which page load this is, bound to the address.
  const token = await readSubmitToken(secret, input.renderToken, form.id, ctx.ipKey, clock());
  const usedKey = token?.kind === 'ok' ? tokenKey(form.id, token.id) : null;

  // 3. The gate (trip 2): the block list and the limits, before anything that costs (uploads),
  // with the password hash, the cap and its exact count, "this fill is saved" and "this page
  // load is used", in one statement. Beside it, the rendered version (a read only when it is the
  // version just replaced).
  const [version, gate] = await Promise.all([
    versionFor(db, form, input.formVersionId),
    submitGate(ctx, form, browserHash, submissionId, usedKey, clock()),
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

  // 4. Honeypot and minimum time since THIS page load: pretend it worked, keep nothing.
  if ((input.hp ?? '') !== '' || token === null || (token.kind === 'ok' && clock() - token.at < MIN_FILL_MS)) {
    console.info(`intelform submit: dropped by spam checks (form ${form.id})`);
    return {ok: true};
  }
  // A genuine token, but the page has been open for over a day, the visitor's address changed
  // since it loaded, or it already saved another response: no fake success (a real person would
  // lose their answers). The form offers a reload that keeps them and fetches a new token.
  if (token.kind !== 'ok') throw new RespondentError(409, 'page_expired', labels.pageExpired);
  if (gate.tokenUsed && !gate.saved) throw new RespondentError(409, 'page_expired', labels.pageExpired);

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
    usedKey,
    confirmIpKey:
      pub.needsJobs && form.settings.confirmationEmail && form.settings.confirmationEmailFieldId ? `confirm-ip:${ctx.ipKey}` : null,
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
    // The page load's token was taken in parallel: by this very fill (a retry), or by another.
    if (out.kind === 'token') {
      if (await alreadySaved(db, form.id, input.submissionId)) return reply(form.settings, def, answers);
      throw new RespondentError(409, 'page_expired', labels.pageExpired);
    }
    throw closedError(form, labels);
  }

  // 8. After commit. A response that reached the cap closed the form: the public forms list and
  // this form's cached page must stop offering it. The notify work is already queued.
  if (out.closedNow) await Promise.all([clearPublicSiteCache(), clearPublicFormSlugs(form.slug)]).catch(() => undefined);
  // The notify job for this minute (one a minute, however many arrive; never throws).
  await wakeNotifyJob(ctx.requestUrl);

  // 9. Reply
  return reply(form.settings, def, answers);
}
