import * as z from 'zod'
import { SAFE_URL_MESSAGE, isSafeUrl } from './safe-url-core'

export { isSafeUrl, safeUrlMini } from './safe-url-core'

/**
 * Every URL stored in a form definition or theme: trimmed, absolute, http or https only.
 * Classic zod, so callers can chain `.nullable()` etc. The registry (and so the respondent
 * bundle) uses `safeUrlMini` from safe-url-core.ts, which behaves the same.
 */
export const safeUrl = z.string().trim().max(2048).refine(isSafeUrl, { message: SAFE_URL_MESSAGE })
