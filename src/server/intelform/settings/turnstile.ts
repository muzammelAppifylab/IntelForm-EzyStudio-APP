import type {SettingsTestResult} from '../../../lib/intelform/settings-app';
import {turnstileTestResult} from './view';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Checks the Turnstile secret key (an owner secret) with Cloudflare, without a real visitor:
 * a dummy token is always refused, and the error code says whether the KEY was the problem.
 * The secret goes only to Cloudflare, never into a log or the answer.
 */
export async function testTurnstileSecret(secret: string, fetcher: typeof fetch = fetch): Promise<SettingsTestResult> {
  try {
    const res = await fetcher(SITEVERIFY, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret, response: 'XXXX.DUMMY.TOKEN.XXXX'}),
      signal: AbortSignal.timeout(10_000),
    });
    const reply = (await res.json().catch(() => null)) as {success?: boolean; 'error-codes'?: string[]} | null;
    return turnstileTestResult(reply);
  } catch {
    console.warn('turnstile test: Cloudflare could not be reached');
    return {ok: false, message: 'Couldn’t reach Cloudflare. Try again in a minute.'};
  }
}
