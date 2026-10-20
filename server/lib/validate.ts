import type { Context } from 'hono'
import { z } from 'zod'
import { ApiError } from './errors'

/** Parses a JSON body against a shared zod schema; failures become a 422 with per-field messages. */
export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body must be JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    const { fieldErrors, formErrors } = z.flattenError(result.error)
    const message = formErrors[0] ?? 'Check the highlighted fields'
    throw new ApiError(422, 'validation_failed', message, fieldErrors as Record<string, string[] | undefined>)
  }
  return result.data
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads a uuid route param; anything malformed is a 404, not a database error. */
export function uuidParam(c: Context, name: string, notFoundMessage = 'Not found'): string {
  const value = c.req.param(name) ?? ''
  if (!UUID_RE.test(value)) throw new ApiError(404, 'not_found', notFoundMessage)
  return value
}
