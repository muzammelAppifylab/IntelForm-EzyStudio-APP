import {RespondentError} from './errors';

/**
 * Cloudflare Turnstile siteverify (spam pipeline step 6). Checks success, action "submit" and
 * the hostname; fails closed when Cloudflare can't be reached. A fixed https origin, a timeout,
 * the response's shape checked (docs/agent/security.md "Calling other services"). The secret
 * comes from `config.ownerSecret('TURNSTILE_SECRET_KEY')` (load.ts turnstileFor).
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Tests replace the network call. */
export function setTurnstileFetch(f: Fetch | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

interface SiteverifyResult {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
}

/** Cloudflare's documented test secrets answer with hostname "example.com". */
const isTestSecret = (secret: string) => /^[123]x0{20,}/.test(secret);

export async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  remoteIp: string | null,
  /** The hostname the form was served from (the request's own host). */
  expectedHost: string
): Promise<void> {
  const fail = () => new RespondentError(403, 'turnstile_failed', 'We couldn’t check that you’re human. Try submitting again.');
  if (!token) throw fail();
  const body = new URLSearchParams({secret, response: token, idempotency_key: crypto.randomUUID()});
  if (remoteIp) body.set('remoteip', remoteIp);
  let result: SiteverifyResult;
  try {
    const res = await fetchImpl(VERIFY_URL, {method: 'POST', body, signal: AbortSignal.timeout(8000)});
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== 'object' || typeof (json as SiteverifyResult).success !== 'boolean') throw new Error('bad answer');
    result = json as SiteverifyResult;
  } catch {
    console.warn('intelform turnstile: siteverify unreachable');
    throw new RespondentError(503, 'turnstile_failed', 'We couldn’t check that you’re human just now. Try again in a moment.');
  }
  if (!result.success) throw fail();
  if (result.action && result.action !== 'submit') throw fail();
  if (result.hostname && result.hostname !== expectedHost && !isTestSecret(secret)) {
    console.warn('intelform turnstile: hostname mismatch');
    throw fail();
  }
}
