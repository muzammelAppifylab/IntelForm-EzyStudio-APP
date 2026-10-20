import type { MiddlewareHandler } from 'hono'
import { requestId } from 'hono/request-id'
import { pino, type LoggerOptions } from 'pino'
import { env, isTest } from '../env'

/**
 * Error fields that can carry row data or SQL: postgres puts the offending values in `detail`
 * ("Key (email)=(a@b.com) already exists"), `where`, `hint` and `internal_query`, and
 * postgres.js attaches `query`, `parameters`, `args` and `types`. They are dropped from logged
 * errors; `code`, `constraint_name`, `table_name`, `column_name` and the stack stay.
 */
const ERROR_DATA_FIELDS = ['detail', 'hint', 'where', 'position', 'internal_query', 'internal_position', 'query', 'parameters', 'args', 'types']

/**
 * pino's error serializer, then the data-bearing fields removed, also from causes, aggregated
 * errors and errors nested in a plain object.
 */
export function serializeError(err: unknown): unknown {
  return scrubError(err, 0)
}

function scrubError(value: unknown, depth: number): unknown {
  if (!value || typeof value !== 'object') return value
  if (depth > 5) return '[too deep]'
  const obj: object = value instanceof Error ? pino.stdSerializers.err(value) : value
  if (Array.isArray(obj)) return obj.map((v) => scrubError(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (ERROR_DATA_FIELDS.includes(k)) continue
    out[k] = scrubError(v, depth + 1)
  }
  return out
}

/**
 * JSON logs to stdout. Passwords, tokens, cookies and authorization headers are redacted, and
 * raw IPs are never logged (only the salted hash, where needed). Logged errors lose fields that
 * carry row data (see ERROR_DATA_FIELDS).
 */
export const loggerOptions = {
  level: env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  base: { service: 'intelform' },
  serializers: { err: serializeError, error: serializeError },
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
} satisfies LoggerOptions

export const logger = pino(loggerOptions)

/** Adds X-Request-Id (accepts a sane incoming one) and exposes it as c.var.requestId. */
export const requestIdMiddleware = requestId({
  headerName: 'X-Request-Id',
  limitLength: 64,
  generator: () => crypto.randomUUID(),
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The request path with secrets in it replaced, for logs. Invite links carry their token in
 * the path (/api/invites/<token>, …/accept), and uploaded files are unguessable capability
 * URLs (respondent signatures, file answers), so both are cut. Invite ids (UUIDs, used by the
 * dashboard's DELETE) are not secret and stay.
 */
export function redactPath(path: string): string {
  return path
    .replace(/^(\/api\/invites\/)([^/]+)/, (all, prefix: string, seg: string) => (UUID.test(seg) ? all : `${prefix}[redacted]`))
    .replace(/^(\/api\/uploads\/files\/(?:.*\/)?)[^/]+$/, '$1[redacted]')
}

/** One line per API request: method, path (secrets cut, see redactPath), status, duration, user id and role. */
export const accessLog: MiddlewareHandler = async (c, next) => {
  const start = performance.now()
  await next()
  const user = c.get('user' as never) as { id: string; role: string } | undefined
  const status = c.res.status
  const line = {
    reqId: c.get('requestId' as never) as string | undefined,
    method: c.req.method,
    path: redactPath(c.req.path),
    status,
    ms: Math.round(performance.now() - start),
    userId: user?.id,
    role: user?.role,
  }
  if (c.req.path === '/api/health' || c.req.path === '/api/ready') logger.debug(line, 'request')
  else if (status >= 500) logger.error(line, 'request')
  else logger.info(line, 'request')
}
