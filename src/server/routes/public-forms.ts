import {type Context, Hono} from 'hono';

import type {PrismaClient} from '../../generated/prisma/client';
import {verifyPassword} from '../../platform/auth/password';
import {cache} from '../../platform/cache';
import {withDb} from '../../platform/guards';
import {UNLOCK_HEADER, unlockInput, type UnlockResponse} from '../../lib/intelform/api-public';
import {SYSTEM_LABELS} from '../../lib/intelform/form/labels';
import {ipKeyFor, requireSecret, respondentIp} from '../intelform/respondent/crypto';
import {notFound, RespondentError, respondentError} from '../intelform/respondent/errors';
import {handleEvent} from '../intelform/respondent/events';
import {publicPayload, requireForm, SLUG_RE} from '../intelform/respondent/load';
import {limitedPayload, PUBLIC_GET_MESSAGE} from '../intelform/respondent/page';
import {hit, peek, rateLimit, release, tooMany} from '../intelform/respondent/rate-limit';
import {requestMeta} from '../intelform/respondent/request-meta';
import {handleSubmit} from '../intelform/respondent/submit';
import {readRenderToken, renderToken, unlockToken} from '../intelform/respondent/tokens';

export {loadPublicForm, safeJson, type PublicFormPage} from '../intelform/respondent/page';

/**
 * `/site-api/public/forms/:slug/*`: the respondent side, ANONYMOUS (no sign-in, no cookies).
 *
 *   GET  /:slug            the published form (live, closed, locked or moved), with a render token
 *   POST /:slug/unlock     {password} → {token, form}       (a form password)
 *   POST /:slug/events     {type: view|start, session} → 204 (the funnel)
 *   POST /:slug/responses  SubmitInput → {ok, redirectUrl?}  (the submit pipeline, submit.ts)
 *
 * Mounted in app.ts AFTER `sameOrigin` and BEFORE `csrf` (with the anonymous signature upload,
 * public-signatures.ts): the form is embedded on other websites (public/embed.js), and in a
 * third-party iframe the browser neither stores nor sends the `__Host-site_csrf` cookie, so the
 * double-submit check could never pass there. These routes read no cookie and no viewer (no
 * session, nothing ambient for a forged request to borrow); instead every POST must carry the
 * page's signed render token in `x-intelform-render`, for THIS form, checked first
 * (`requireRendered`). See RENDER_HEADER below for why that is enough.
 *
 * Every route is rate limited per IP hash (and per form) in intelform_rate_limits. Payloads carry
 * a render token and per-request state: never cached.
 */

/**
 * The header every respondent write carries: the render token the server put in the form it
 * handed out (GET /:slug or the /f/<slug> page). Same value in src/respondent/api.ts.
 *
 * Why it replaces `csrf` here:
 * - CSRF is about a forged request riding on the visitor's cookies. These routes take no cookie
 *   and no viewer: a forged request gets nothing a script could not get by calling them itself.
 * - `sameOrigin` still runs first: a browser write from another site's page (Origin /
 *   Sec-Fetch-Site cross-site) is refused. The embedded form passes because the iframe's
 *   document is this site.
 * - A custom header can't be set by a plain HTML form, and a cross-origin `fetch` with it needs
 *   a CORS preflight this site never grants.
 * - The token is an HMAC of (form id, issue time) under the site secret: it can't be forged or
 *   moved to another form, and getting one costs a rate-limited form load. The submit still
 *   checks its own body token (minimum fill time), the honeypot, validation and its limits.
 */
export const RENDER_HEADER = 'x-intelform-render';
/** `<ms>.<32 base64url>` (tokens.ts): anything else is refused without a lookup. */
const RENDER_SHAPE = /^\d{10,16}\.[A-Za-z0-9_-]{32}$/;
/** The refusal for a missing, forged or other-form token (a reload hands out a fresh one). */
const pageInvalid = () => new RespondentError(403, 'page_invalid', 'This form has expired. Reload the page and try again.');

/**
 * The render time of `header` when it is a render token this site issued for `formId`
 * ('expired' past its 24 hours: the route behind decides, `page_expired` with a reload that keeps
 * the answers); null when it is missing, forged or for another form.
 */
export async function readRenderHeader(secret: string, header: string | undefined, formId: string): Promise<number | 'expired' | null> {
  if (!header || !RENDER_SHAPE.test(header)) return null;
  return readRenderToken(secret, header, formId);
}

/**
 * A public slug's form id, for the render-token check. Through the Site Cache: every respondent
 * write reads it and it only changes when a form is renamed or deleted. The key sits under
 * cache.ts's `form:slug:` prefix on purpose (a colon can't occur in a slug), so
 * `clearPublicFormCache()` (after a rename, delete, publish…) clears it too. A miss (unknown slug)
 * is not stored. A stale entry can only refuse a fresh token, never let a wrong one through to
 * more than the route's own checks.
 */
async function formIdForSlug(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<string | null> {
  const clean = slug.toLowerCase();
  if (!SLUG_RE.test(clean)) return null;
  return cache.getOrSet(`form:slug:id:${clean}`, 60 * 60, async () => {
    const rows = await db.$queryRaw<{id: string}[]>`SELECT id::text AS id FROM forms WHERE slug = ${clean} LIMIT 1`;
    return rows[0]?.id ?? null;
  });
}

/** The gate in front of every respondent write: a render token for the form in the URL. */
export async function requireRendered(c: Context, db: Pick<PrismaClient, '$queryRaw'>, secret: string, slug: string): Promise<void> {
  const header = c.req.header(RENDER_HEADER);
  if (!header || !RENDER_SHAPE.test(header)) throw pageInvalid();
  const formId = await formIdForSlug(db, slug);
  if (!formId) throw notFound();
  if ((await readRenderHeader(secret, header, formId)) === null) throw pageInvalid();
}

/**
 * Form password guessing, bounded without letting anyone lock real respondents out (F-006):
 *
 * - every caller (keyed IP hash) gets UNLOCK_IP_LIMIT tries per form per minute and
 *   UNLOCK_IP_FAILURE_LIMIT wrong passwords per form per hour;
 * - wrong passwords from everyone together are counted per form per hour. Past
 *   UNLOCK_FORM_FAILURE_LIMIT the form is "under attack": each caller then gets only
 *   UNLOCK_ATTACK_IP_FAILURES wrong passwords of their own this hour. The form-wide count never
 *   refuses a caller by itself, so a respondent with the right password still gets in, while
 *   guessing spread over many addresses drops to a few tries per address.
 *
 * Why this route calls `verifyPassword` (docs/agent/security.md A07 says not to): this is not a
 * sign-in. It checks a form's shared password, which the built-in auth has no check for, and the
 * managed limiter has fixed kinds; the limits above are the bound that rule asks for, kept in
 * IntelForm's own indexed `intelform_rate_limits` table (security.md "Limit what costs").
 */
export const UNLOCK_FORM_FAILURE_LIMIT = 100;
const UNLOCK_FAILURE_WINDOW = 60 * 60;
/** Password tries per IP per form per minute. */
export const UNLOCK_IP_LIMIT = 10;
/** Wrong passwords per IP per form per hour (normal times). */
export const UNLOCK_IP_FAILURE_LIMIT = 30;
/** Wrong passwords per IP per form per hour while the form is under attack. */
export const UNLOCK_ATTACK_IP_FAILURES = 3;

/** The caller's keyed rate-limit id (never the raw address). */
async function callerKey(c: Context, secret: string): Promise<string> {
  return ipKeyFor(secret, respondentIp(c));
}

async function readText(c: Context): Promise<string> {
  try {
    return await c.req.text();
  } catch {
    throw new RespondentError(400, 'invalid_json', 'The request body must be JSON.');
  }
}

export const publicFormsRoutes = new Hono()
  .use(async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  })

  .get('/:slug', withDb, async c => {
    try {
      const secret = requireSecret();
      const db = c.var.db;
      const unlock = c.req.header(UNLOCK_HEADER);
      // The form from the cache, then ONE statement for the limit (and, only when needed, the
      // exact count or password hash). A 429 wins over whatever the form read found.
      const out = await limitedPayload(db, secret, await callerKey(c, secret), c.req.param('slug'), unlock && unlock.length <= 400 ? unlock : null);
      if (out.kind === 'limited') throw tooMany(out.retryAfter, PUBLIC_GET_MESSAGE);
      const payload = out.payload;
      if (!payload) throw notFound();
      // A locked form gets a render token too: its unlock POST must carry one. It opens nothing
      // (the definition comes only with a valid unlock token).
      if (payload.status === 'locked') return c.json({...payload, renderToken: await renderToken(secret, payload.id)});
      return c.json(payload);
    } catch (err) {
      return respondentError(c, err);
    }
  })

  .post('/:slug/unlock', withDb, async c => {
    try {
      const secret = requireSecret();
      const db = c.var.db;
      await requireRendered(c, db, secret, c.req.param('slug'));
      const form = await requireForm(db, c.req.param('slug'));
      const caller = await callerKey(c, secret);
      await rateLimit(db, `unlock:${caller}:${form.id}`, UNLOCK_IP_LIMIT, 60, 'Too many tries. Wait a minute and try again.');
      let raw: unknown;
      try {
        raw = JSON.parse(await readText(c));
      } catch {
        throw new RespondentError(400, 'invalid_json', 'The request body must be JSON.');
      }
      const parsed = unlockInput.safeParse(raw);
      if (!parsed.success) {
        throw new RespondentError(422, 'validation_failed', SYSTEM_LABELS.wrongPassword, {password: [SYSTEM_LABELS.wrongPassword]});
      }
      const hash = form.settings.passwordHash;
      if (hash) {
        const formKey = `unlock-fail:form:${form.id}`;
        const callerFailKey = `unlock-fail:ip:${caller}:${form.id}`;
        // The form-wide count only picks this caller's own budget; it never refuses anyone itself.
        const underAttack = (await peek(db, formKey, UNLOCK_FAILURE_WINDOW)) >= UNLOCK_FORM_FAILURE_LIMIT;
        // The attempt takes one of the caller's failure slots before the check (their parallel
        // guesses can't overshoot); a correct password gives it back, so only failures count.
        await rateLimit(
          db,
          callerFailKey,
          underAttack ? UNLOCK_ATTACK_IP_FAILURES : UNLOCK_IP_FAILURE_LIMIT,
          UNLOCK_FAILURE_WINDOW,
          underAttack ? 'This form has had too many wrong passwords. Try again later.' : 'Too many wrong passwords. Try again later.'
        );
        const {ok} = await verifyPassword(parsed.data.password, hash);
        if (!ok) {
          await hit(db, formKey, UNLOCK_FAILURE_WINDOW);
          throw new RespondentError(422, 'validation_failed', SYSTEM_LABELS.wrongPassword, {password: [SYSTEM_LABELS.wrongPassword]});
        }
        await release(db, callerFailKey, UNLOCK_FAILURE_WINDOW);
      }
      const token = hash ? await unlockToken(secret, form.id, hash) : '';
      const payload = await publicPayload(db, secret, form, token);
      if (payload.status === 'locked') throw new RespondentError(500, 'server_error', 'Something went wrong on our side. Try again.');
      return c.json({token, form: payload} satisfies UnlockResponse);
    } catch (err) {
      return respondentError(c, err);
    }
  })

  .post('/:slug/events', withDb, async c => {
    try {
      const secret = requireSecret();
      await requireRendered(c, c.var.db, secret, c.req.param('slug'));
      await handleEvent(c.var.db, c.req.param('slug'), await readText(c), await callerKey(c, secret));
      return c.body(null, 204);
    } catch (err) {
      return respondentError(c, err);
    }
  })

  .post('/:slug/responses', withDb, async c => {
    try {
      const secret = requireSecret();
      await requireRendered(c, c.var.db, secret, c.req.param('slug'));
      const ip = respondentIp(c);
      const result = await handleSubmit(
        {
          db: c.var.db,
          secret,
          requestUrl: c.req.url,
          ipKey: await ipKeyFor(secret, ip),
          meta: () => requestMeta(c, secret),
        },
        c.req.param('slug'),
        await readText(c)
      );
      return c.json(result);
    } catch (err) {
      return respondentError(c, err);
    }
  });
