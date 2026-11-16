import {hmacBase64Url, hmacHex, safeEqual} from './crypto';

/**
 * Small HMAC tokens for the respondent flow. None of them are cookies: the form runs inside
 * third-party iframes, where cookies are partitioned or blocked.
 *
 * - render token: `<ms>.<mac>` proves when the server handed out the form (minimum fill time).
 *   Good for 24 hours, so one page load can't be replayed for submits forever.
 * - unlock token: `<exp>.<mac>` after a correct form password; bound to the current hash, so
 *   changing the password invalidates every token.
 * - browser token hash: what responses.browser_token stores for one-response-per-browser.
 *
 * Keyed from the site secret (crypto.ts); `secret` is a parameter so tests need no env.
 */
const PURPOSE = 'respondent-tokens';

async function mac(secret: string, ...parts: string[]): Promise<string> {
  return (await hmacBase64Url(secret, PURPOSE, parts.join('|'))).slice(0, 32);
}

export const RENDER_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const UNLOCK_TTL_MS = 3 * 60 * 60 * 1000;

export async function renderToken(secret: string, formId: string, now = Date.now()): Promise<string> {
  return `${now}.${await mac(secret, 'render', formId, String(now))}`;
}

/**
 * The render time in epoch ms; 'expired' for a genuine token older than 24 hours (the page
 * has simply been open that long); null if the token is forged or for another form.
 */
export async function readRenderToken(
  secret: string,
  token: string,
  formId: string,
  now = Date.now()
): Promise<number | 'expired' | null> {
  const [ts, sig, extra] = token.split('.');
  if (!ts || !sig || extra !== undefined || !/^\d{10,16}$/.test(ts)) return null;
  if (!safeEqual(sig, await mac(secret, 'render', formId, ts))) return null;
  return now - Number(ts) > RENDER_TOKEN_MAX_AGE_MS ? 'expired' : Number(ts);
}

export async function unlockToken(secret: string, formId: string, passwordHash: string, now = Date.now()): Promise<string> {
  const exp = String(now + UNLOCK_TTL_MS);
  return `${exp}.${await mac(secret, 'unlock', formId, exp, passwordHash)}`;
}

export async function checkUnlockToken(
  secret: string,
  token: string | undefined | null,
  formId: string,
  passwordHash: string,
  now = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const [exp, sig, extra] = token.split('.');
  if (!exp || !sig || extra !== undefined || !/^\d{10,16}$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, await mac(secret, 'unlock', formId, exp, passwordHash));
}

/** 40 hex: fits responses.browser_token (VarChar 64). The raw token is never stored. */
export async function hashBrowserToken(secret: string, formId: string, token: string): Promise<string> {
  return (await hmacHex(secret, PURPOSE, `browser|${formId}|${token}`)).slice(0, 40);
}
