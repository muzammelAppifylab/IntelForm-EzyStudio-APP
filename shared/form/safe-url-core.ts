import * as z from 'zod/mini'

/**
 * URL safety without classic zod, for the field-type registry and anything the respondent
 * bundle imports. `safe-url.ts` re-exports `isSafeUrl` and keeps the classic `safeUrl` schema.
 */

/** True for absolute http(s) URLs with a host. Rejects javascript:, data:, file: and relative URLs. */
export function isSafeUrl(value: string): boolean {
  if (value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
}

export const SAFE_URL_MESSAGE = 'Enter a full link starting with https://'

/** `safeUrl` as a zod/mini schema: trimmed, at most 2048 characters, http or https only. */
export const safeUrlMini = z.string().check(z.trim(), z.maxLength(2048), z.refine(isSafeUrl, { message: SAFE_URL_MESSAGE }))
