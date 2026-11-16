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
import {rateLimit, release} from '../intelform/respondent/rate-limit';
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

/** Wrong passwords per form per hour from everyone together (guessing spread over many addresses). */
export const UNLOCK_FORM_FAILURE_LIMIT = 100;
const UNLOCK_FORM_WINDOW = 60 * 60;
/** Password tries per IP per form per minute. */
export const UNLOCK_IP_LIMIT = 10;

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
      await rateLimit(db, `unlock:${await callerKey(c, secret)}:${form.id}`, UNLOCK_IP_LIMIT, 60, 'Too many tries. Wait a minute and try again.');
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
      // Every attempt takes a slot before the check (parallel guesses can't overshoot); a correct
      // password gives it back, so only failures count.
      const formKey = `unlock-fail:form:${form.id}`;
      if (hash) {
        await rateLimit(db, formKey, UNLOCK_FORM_FAILURE_LIMIT, UNLOCK_FORM_WINDOW, 'This form has had too many wrong passwords. Try again later.');
        const {ok} = await verifyPassword(parsed.data.password, hash);
        if (!ok) throw new RespondentError(422, 'validation_failed', SYSTEM_LABELS.wrongPassword, {password: [SYSTEM_LABELS.wrongPassword]});
        await release(db, formKey, UNLOCK_FORM_WINDOW);
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
