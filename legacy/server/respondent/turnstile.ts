import { randomUUID } from 'node:crypto'
import { appOrigin } from '../env'
import { ApiError } from '../lib/errors'
import { logger } from '../lib/logger'

/**
 * Cloudflare Turnstile siteverify (docs/research/03-respondent.md "Spam pipeline" step 6).
 * Checks success, action "submit" and the hostname; fails closed when Cloudflare can't be reached.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

type Fetch = typeof fetch
let fetchImpl: Fetch = (...args) => fetch(...args)
/** Tests replace the network call. */
export function setTurnstileFetch(f: Fetch | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args))
}

interface SiteverifyResult {
  success: boolean
  'error-codes'?: string[]
  hostname?: string
  action?: string
}

/** Cloudflare's documented test secrets answer with hostname "example.com". */
const isTestSecret = (secret: string) => /^[123]x0{20,}/.test(secret)

export async function verifyTurnstile(secret: string, token: string | undefined, remoteIp: string | null): Promise<void> {
  const fail = (message = 'We couldn’t check that you’re human. Try submitting again.') =>
    new ApiError(403, 'turnstile_failed', message)
  if (!token) throw fail()
  const body = new URLSearchParams({ secret, response: token, idempotency_key: randomUUID() })
  if (remoteIp) body.set('remoteip', remoteIp)
  let result: SiteverifyResult
  try {
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) })
    result = (await res.json()) as SiteverifyResult
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'turnstile siteverify unreachable')
    throw new ApiError(503, 'turnstile_failed', 'We couldn’t check that you’re human just now. Try again in a moment.')
  }
  if (!result.success) throw fail()
  if (result.action && result.action !== 'submit') throw fail()
  const host = new URL(appOrigin).hostname
  if (result.hostname && result.hostname !== host && !isTestSecret(secret)) {
    logger.warn({ hostname: result.hostname }, 'turnstile hostname mismatch')
    throw fail()
  }
}
