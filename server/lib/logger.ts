import type { MiddlewareHandler } from 'hono'
import { requestId } from 'hono/request-id'
import { pino } from 'pino'
import { env, isTest } from '../env'

/**
 * JSON logs to stdout. Passwords, tokens, cookies and authorization headers are redacted, and
 * raw IPs are never logged (only the salted hash, where needed).
 */
export const logger = pino({
  level: env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  base: { service: 'intelform' },
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'secret',
      'apiKey',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.pass',
      'headers.cookie',
      'headers.authorization',
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
})

/** Adds X-Request-Id (accepts a sane incoming one) and exposes it as c.var.requestId. */
export const requestIdMiddleware = requestId({
  headerName: 'X-Request-Id',
  limitLength: 64,
  generator: () => crypto.randomUUID(),
})

/** One line per API request: method, path, status, duration, user id and role. */
export const accessLog: MiddlewareHandler = async (c, next) => {
  const start = performance.now()
  await next()
  const user = c.get('user' as never) as { id: string; role: string } | undefined
  const status = c.res.status
  const line = {
    reqId: c.get('requestId' as never) as string | undefined,
    method: c.req.method,
    path: c.req.path,
    status,
    ms: Math.round(performance.now() - start),
    userId: user?.id,
    role: user?.role,
  }
  if (c.req.path === '/api/health' || c.req.path === '/api/ready') logger.debug(line, 'request')
  else if (status >= 500) logger.error(line, 'request')
  else logger.info(line, 'request')
}
