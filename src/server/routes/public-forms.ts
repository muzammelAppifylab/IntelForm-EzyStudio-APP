import {type Context, Hono} from 'hono';

import {verifyPassword} from '../../platform/auth/password';
import {withDb} from '../../platform/guards';
import {UNLOCK_HEADER, unlockInput, type UnlockResponse} from '../../lib/intelform/api-public';
import {SYSTEM_LABELS} from '../../lib/intelform/form/labels';
import {ipKeyFor, requireSecret, respondentIp} from '../intelform/respondent/crypto';
import {notFound, RespondentError, respondentError} from '../intelform/respondent/errors';
import {handleEvent} from '../intelform/respondent/events';
import {payloadForSlug, publicPayload, requireForm} from '../intelform/respondent/load';
import {limitPublicGet} from '../intelform/respondent/page';
import {hit, peek, rateLimit, release} from '../intelform/respondent/rate-limit';
import {requestMeta} from '../intelform/respondent/request-meta';
import {handleSubmit} from '../intelform/respondent/submit';
import {unlockToken} from '../intelform/respondent/tokens';

export {loadPublicForm, safeJson, type PublicFormPage} from '../intelform/respondent/page';

/**
 * `/site-api/public/forms/:slug/*`: the respondent side, ANONYMOUS (no sign-in, no cookies of
 * its own). Same-origin like every Site API write: the form page `/f/<slug>` and its embed are
 * pages of this site, and the browser calls these with `siteFetch` (CSRF token included).
 *
 *   GET  /:slug            the published form (live, closed, locked or moved), with a render token
 *   POST /:slug/unlock     {password} → {token, form}       (a form password)
 *   POST /:slug/events     {type: view|start, session} → 204 (the funnel)
 *   POST /:slug/responses  SubmitInput → {ok, redirectUrl?}  (the submit pipeline, submit.ts)
 *
 * Every route is rate limited per IP hash (and per form) in intelform_rate_limits. Payloads carry
 * a render token and per-request state: never cached.
 */

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
      // The limit and the form in one trip; a 429 wins over whatever the form read found.
      const [, payload] = await Promise.all([
        limitPublicGet(db, await callerKey(c, secret)),
        payloadForSlug(db, secret, c.req.param('slug'), unlock && unlock.length <= 400 ? unlock : null),
      ]);
      if (!payload) throw notFound();
      return c.json(payload);
    } catch (err) {
      return respondentError(c, err);
    }
  })

  .post('/:slug/unlock', withDb, async c => {
    try {
      const secret = requireSecret();
      const db = c.var.db;
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
      await handleEvent(c.var.db, c.req.param('slug'), await readText(c), await callerKey(c, secret));
      return c.body(null, 204);
    } catch (err) {
      return respondentError(c, err);
    }
  })

  .post('/:slug/responses', withDb, async c => {
    try {
      const secret = requireSecret();
      const ip = respondentIp(c);
      const result = await handleSubmit(
        {
          db: c.var.db,
          secret,
          requestUrl: c.req.url,
          ip,
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
