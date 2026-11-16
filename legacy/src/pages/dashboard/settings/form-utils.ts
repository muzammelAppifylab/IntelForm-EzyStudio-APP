import type { z } from 'zod'
import { ApiRequestError, errorMessage } from '@/lib/api'

export type Errors = Record<string, string | undefined>

/** Validates with a shared zod schema; errors keyed by dotted path ("hero.buttonUrl", "featured"). */
export function zodErrors<T extends z.ZodType>(schema: T, value: unknown): { data: z.infer<T>; errors: null } | { data: null; errors: Errors } {
  const r = schema.safeParse(value)
  if (r.success) return { data: r.data, errors: null }
  const errors: Errors = {}
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_form'
    errors[key] ??= issue.message
  }
  return { data: null, errors }
}

/** Maps an API error onto fields, prefixing the group ("general.appName"); else a form message. */
export function apiErrors(err: unknown, prefix?: string): Errors {
  if (err instanceof ApiRequestError && Object.keys(err.fields).length) {
    return Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [prefix && !k.startsWith(`${prefix}.`) ? `${prefix}.${k}` : k, v?.[0]]))
  }
  return { _form: errorMessage(err) }
}

/** JSON equality for small plain objects (dirty checks). */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
