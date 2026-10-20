import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import type { HealthResponse } from '../shared/api'
import { sql } from './db/client'
import { appOrigin } from './env'
import { ApiError, conflict, errorResponse, isUniqueViolation } from './lib/errors'
import { accessLog, logger, requestIdMiddleware } from './lib/logger'
import { surfaceHeaders } from './middleware/security-headers'
import { authRoutes } from './routes/auth'
import { builderRoutes } from './routes/builder'
import { formsRoutes } from './routes/forms'
import { frontPageRoutes } from './routes/front-page'
import { inviteRoutes } from './routes/invites'
import { meRoutes } from './routes/me'
import { publicFormRoutes } from './routes/public-forms'
import { publicRoutes } from './routes/public'
import { responsesRoutes } from './routes/responses'
import { settingsRoutes } from './routes/settings'
import { setupRoutes } from './routes/setup'
import { teamRoutes } from './routes/team'
import { templatesRoutes } from './routes/templates'
import { themesRoutes } from './routes/themes'
import { uploadsRoutes } from './routes/uploads'
// Job handlers register themselves on import (email, webhook).
import './lib/email'
import './lib/webhooks'

/**
 * Every API route, as one Hono app built on Web-standard Request/Response. This is the unit
 * that maps onto EzyStudio API routes; server/index.ts only adds a Node listener and static files.
 */
export const app = new Hono().basePath('/api')

/** Request body limits (A10): 256 KB by default, more where content is large. */
const MB = 1024 * 1024
function maxBodyFor(path: string): number {
  if (path.startsWith('/api/uploads')) return 6 * MB // 5 MB image + multipart overhead
  if (/^\/api\/public\/forms\/[^/]+\/responses/.test(path)) return 3 * MB // signature PNGs inside a submit
  if (/^\/api\/(forms|builder|themes|templates|front-page)(\/|$)/.test(path)) return 2 * MB // form definitions
  return 256 * 1024
}

// Registered first so every response, including a CSRF 403 or a 413, gets them (A13).
app.use(requestIdMiddleware)
app.use(accessLog)
app.use(surfaceHeaders('api'))
app.use(async (c, next) => {
  await next()
  // API responses are never indexed; dashboard data must not end up in a cache either.
  c.header('X-Robots-Tag', 'noindex')
  const path = c.req.path
  if (!path.startsWith('/api/public/') && !path.startsWith('/api/uploads/files/') && !c.res.headers.has('Cache-Control')) {
    c.header('Cache-Control', 'no-store')
  }
})
app.use((c, next) =>
  bodyLimit({
    maxSize: maxBodyFor(c.req.path),
    onError: () => {
      throw new ApiError(413, 'payload_too_large', 'That request is too large')
    },
  })(c, next),
)
// Rejects cross-site form posts. JSON bodies already need a CORS preflight, which we never grant.
app.use(csrf({ origin: (origin) => origin === appOrigin }))

app.get('/health', (c) => c.json<HealthResponse>({ ok: true }))
app.get('/ready', async (c) => {
  try {
    await sql`SELECT 1`
    return c.json<HealthResponse>({ ok: true, database: 'ok' })
  } catch {
    return c.json<HealthResponse>({ ok: false, database: 'unavailable' }, 503)
  }
})

app.route('/setup', setupRoutes)
app.route('/auth', authRoutes)
app.route('/me', meRoutes)
app.route('/team', teamRoutes)
app.route('/invites', inviteRoutes)
app.route('/public', publicRoutes)
app.route('/public/forms', publicFormRoutes)
app.route('/forms', formsRoutes)
app.route('/forms', responsesRoutes)
app.route('/templates', templatesRoutes)
app.route('/themes', themesRoutes)
app.route('/builder', builderRoutes)
app.route('/settings', settingsRoutes)
app.route('/uploads', uploadsRoutes)
app.route('/front-page', frontPageRoutes)

app.notFound((c) => errorResponse(c, new ApiError(404, 'not_found', 'No such API route')))

app.onError((err, c) => {
  if (err instanceof ApiError) return errorResponse(c, err)
  // Two requests raced on a unique index (A11): a conflict, not a server error.
  if (isUniqueViolation(err)) return errorResponse(c, conflict())
  // Thrown by Hono middleware, e.g. csrf() with 403 for a cross-site form post.
  if (err instanceof HTTPException && err.status < 500) {
    return errorResponse(c, new ApiError(err.status, 'request_rejected', 'This request was rejected'))
  }
  const requestId = c.get('requestId')
  logger.error({ err, reqId: requestId, method: c.req.method, path: c.req.path }, 'unhandled error')
  return errorResponse(c, new ApiError(500, 'server_error', 'Something went wrong on our side. Try again.'), requestId)
})

export type App = typeof app
