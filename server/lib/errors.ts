import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiErrorBody } from '../../shared/api'

/** Throw from any route; the app's error handler turns it into an ApiErrorBody. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly fields?: Record<string, string[] | undefined>
  /** Extra response headers, e.g. Retry-After on a 429. */
  readonly headers?: Record<string, string>

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    fields?: Record<string, string[] | undefined>,
    headers?: Record<string, string>,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
    this.headers = headers
  }
}

export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message)
export const forbidden = (message = "You don't have permission to do that") => new ApiError(403, 'forbidden', message)
export const conflict = (message = 'Someone else changed this at the same time. Refresh and try again.') => new ApiError(409, 'conflict', message)

export function errorResponse(c: Context, err: ApiError, requestId?: string) {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message, fields: err.fields, requestId } }
  for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v)
  return c.json(body, err.status)
}

/** Postgres unique violation (23505), e.g. two requests racing on a unique index. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}
