import { createHmac } from 'node:crypto'
import { safeEqual, subkey } from '../lib/crypto'

/**
 * Small HMAC tokens for the respondent flow. None of them are cookies: the form runs inside
 * third-party iframes, where cookies are partitioned or blocked.
 *
 * - render token: `<ms>.<mac>` proves when the server handed out the form (minimum fill time).
 * - unlock token: `<exp>.<mac>` after a correct form password; bound to the current hash, so
 *   changing the password invalidates every token.
 * - browser token hash: what responses.browser_token stores for one-response-per-browser.
 */
const key = subkey('respondent-tokens')

function mac(...parts: string[]): string {
  return createHmac('sha256', key).update(parts.join('|')).digest('base64url').slice(0, 32)
}

export function renderToken(formId: string, now = Date.now()): string {
  return `${now}.${mac('render', formId, String(now))}`
}

/** The render time in epoch ms, or null if the token is forged or for another form. */
export function readRenderToken(token: string, formId: string): number | null {
  const [ts, sig] = token.split('.')
  if (!ts || !sig || !/^\d{10,16}$/.test(ts)) return null
  return safeEqual(sig, mac('render', formId, ts)) ? Number(ts) : null
}

export const UNLOCK_TTL_MS = 3 * 60 * 60 * 1000

export function unlockToken(formId: string, passwordHash: string, now = Date.now()): string {
  const exp = String(now + UNLOCK_TTL_MS)
  return `${exp}.${mac('unlock', formId, exp, passwordHash)}`
}

export function checkUnlockToken(token: string | undefined | null, formId: string, passwordHash: string, now = Date.now()): boolean {
  if (!token) return false
  const [exp, sig] = token.split('.')
  if (!exp || !sig || !/^\d{10,16}$/.test(exp) || Number(exp) < now) return false
  return safeEqual(sig, mac('unlock', formId, exp, passwordHash))
}

export function hashBrowserToken(formId: string, token: string): string {
  return createHmac('sha256', key).update(`browser|${formId}|${token}`).digest('hex').slice(0, 40)
}
