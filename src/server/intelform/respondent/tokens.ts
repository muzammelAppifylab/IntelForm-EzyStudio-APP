import {hmacBase64Url, hmacHex, safeEqual} from './crypto';

/**
 * Small HMAC tokens for the respondent flow. None of them are cookies: the form runs inside
 * third-party iframes, where cookies are partitioned or blocked.
 *
 * - render token: `<ms>.<nonce>.<mac>.<ip>` proves when the server handed out THIS page load (the
 *   minimum fill time) and to which address block. Good for 24 hours and for ONE saved response
 *   (submit.ts claims `<mac>` with the response): a bot can't load the page once and submit it
 *   forever, nor share one load across addresses. The nonce makes two loads in the same
 *   millisecond two tokens. `<ip>` is a separate tag so a person whose address changed mid-fill
 *   (Wi-Fi to mobile) is told to reload (keeping their answers) instead of being dropped as a bot.
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

/** The caller key of a request with no address (local development, tests): crypto.ts `ipKeyFor`. */
export const LOCAL_IP_KEY = 'local';

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ipTag = async (secret: string, formId: string, ts: string, n: string, ipKey: string) =>
  (await mac(secret, 'render-ip', formId, ts, n, ipKey)).slice(0, 16);

/** A render token for one page load of `formId` by the caller whose key is `ipKey`. */
export async function renderToken(secret: string, formId: string, now = Date.now(), ipKey: string = LOCAL_IP_KEY): Promise<string> {
  const ts = String(now);
  const n = nonce();
  return `${ts}.${n}.${await mac(secret, 'render', formId, ts, n)}.${await ipTag(secret, formId, ts, n, ipKey)}`;
}

/** `<ms>.<nonce 16>.<mac 32>.<ip 16>`: anything else is refused without a lookup. */
export const RENDER_TOKEN_SHAPE = /^\d{10,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{16}$/;

async function parts(secret: string, token: string, formId: string): Promise<{ts: string; n: string; sig: string; ip: string} | null> {
  if (typeof token !== 'string' || !RENDER_TOKEN_SHAPE.test(token)) return null;
  const [ts, n, sig, ip] = token.split('.') as [string, string, string, string];
  if (!safeEqual(sig, await mac(secret, 'render', formId, ts, n))) return null;
  return {ts, n, sig, ip};
}

/**
 * The render time in epoch ms; 'expired' for a genuine token older than 24 hours (the page
 * has simply been open that long); null if the token is forged or for another form. Doesn't look
 * at the address: the gate in front of every respondent write (public-forms.ts) uses this.
 */
export async function readRenderToken(
  secret: string,
  token: string,
  formId: string,
  now = Date.now()
): Promise<number | 'expired' | null> {
  const p = await parts(secret, token, formId);
  if (!p) return null;
  return now - Number(p.ts) > RENDER_TOKEN_MAX_AGE_MS ? 'expired' : Number(p.ts);
}

/** What the submit learns from its render token. */
export type SubmitToken =
  /** `at`: when this page load happened; `id`: the token's own id, claimed by the one response it may save. */
  | {kind: 'ok'; at: number; id: string}
  /** Genuine, but older than 24 hours: reload (the answers are kept). */
  | {kind: 'expired'}
  /** Genuine, for another address block: the caller's address changed since the page loaded. */
  | {kind: 'moved'};

/** The submit's check: genuine, for this form, recent, and for the caller's address block. Null: forged. */
export async function readSubmitToken(secret: string, token: string, formId: string, ipKey: string, now = Date.now()): Promise<SubmitToken | null> {
  const p = await parts(secret, token, formId);
  if (!p) return null;
  if (now - Number(p.ts) > RENDER_TOKEN_MAX_AGE_MS) return {kind: 'expired'};
  if (!safeEqual(p.ip, await ipTag(secret, formId, p.ts, p.n, ipKey))) return {kind: 'moved'};
  return {kind: 'ok', at: Number(p.ts), id: p.sig};
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
