import { Hono } from 'hono'
import { UNLOCK_HEADER, unlockInput, type UnlockResponse } from '../../shared/api-public'
import { resolveLabels } from '../../shared/form/labels'
import { ApiError, notFound } from '../lib/errors'
import { ipKey } from '../lib/ip'
import { verifyFormPassword } from '../lib/password'
import { rateLimit } from '../lib/rate-limit'
import { readBody } from '../lib/validate'
import { handleEvent } from '../respondent/events'
import { payloadForSlug, publicPayload, requireForm } from '../respondent/load'
import { handleSubmit } from '../respondent/submit'
import { unlockToken } from '../respondent/tokens'

/**
 * Respondent routes under /api/public/forms/:slug (definition, unlock, events, submit). No
 * session, no cookies; every write is rate limited per IP and form. Owned by: Agent E (respondent).
 */
export const publicFormRoutes = new Hono()

publicFormRoutes.use(async (c, next) => {
  await next()
  // Payloads carry a render token and per-request state: never cache them.
  c.header('Cache-Control', 'no-store')
})

/** Public GETs per IP per minute, across all forms: enough for any person, not for a scraper. */
export const PUBLIC_GET_RATE_LIMIT = 300

publicFormRoutes.get('/:slug', async (c) => {
  await rateLimit(`public-form:${ipKey(c)}`, PUBLIC_GET_RATE_LIMIT, 60, 'Too many requests. Wait a minute and try again.')
  const payload = await payloadForSlug(c.req.param('slug'), c.req.header(UNLOCK_HEADER))
  if (!payload) throw notFound('This form doesn’t exist')
  return c.json(payload)
})

publicFormRoutes.post('/:slug/unlock', async (c) => {
  const form = await requireForm(c.req.param('slug'))
  await rateLimit(`unlock:${ipKey(c)}:${form.id}`, 10, 60, 'Too many tries. Wait a minute and try again.')
  const { password } = await readBody(c, unlockInput)
  const hash = form.settings.passwordHash
  const labels = resolveLabels({ ...form.definition.labels, ...form.settings.labels })
  if (hash && !(await verifyFormPassword(hash, password))) {
    throw new ApiError(422, 'validation_failed', labels.wrongPassword, { password: [labels.wrongPassword] })
  }
  const token = hash ? unlockToken(form.id, hash) : ''
  const payload = await publicPayload(form, token)
  if (payload.status === 'locked') throw new ApiError(500, 'server_error', 'Something went wrong on our side. Try again.')
  return c.json<UnlockResponse>({ token, form: payload })
})

publicFormRoutes.post('/:slug/events', async (c) => {
  await handleEvent(c, c.req.param('slug'))
  return c.body(null, 204)
})

publicFormRoutes.post('/:slug/responses', async (c) => {
  return c.json(await handleSubmit(c, c.req.param('slug')))
})

