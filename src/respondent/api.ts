import type {ApiErrorBody} from '../lib/intelform/api';
import type {
  FormEventType,
  PublicFormResponse,
  SubmitInput,
  SubmitResponse,
  UNLOCK_HEADER as UnlockHeader,
  UnlockResponse,
} from '../lib/intelform/api-public';
/**
 * The respondent's network calls to the Site API's public form routes
 * (`/site-api/public/forms/:slug`, src/server/routes/public-forms.ts). No router, no query
 * cache, no dashboard code.
 *
 * A plain same-origin `fetch`, not `siteFetch`, on purpose: these routes are anonymous and
 * mounted BEFORE `csrf` (the form runs in other websites' iframes, where the CSRF cookie is never
 * stored), so there is no session to carry and no CSRF token to fetch first. Every write instead
 * carries the page's render token in RENDER_HEADER, which the server checks against the form.
 *
 * Same value as UNLOCK_HEADER in src/lib/intelform/api-public.ts (the literal type keeps them in
 * step). Not imported at runtime: that module builds zod schemas, which would pull zod into the
 * respondent bundle.
 */
const UNLOCK_HEADER: typeof UnlockHeader = 'x-intelform-unlock';
/** Same value as RENDER_HEADER in src/server/routes/public-forms.ts (a test keeps them equal). */
export const RENDER_HEADER = 'x-intelform-render';

export const PUBLIC_FORMS_API = '/site-api/public/forms';
export const publicFormPath = (slug: string) => `${PUBLIC_FORMS_API}/${encodeURIComponent(slug)}`;

export class PublicApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string[] | undefined>;
  constructor(status: number, body?: Partial<ApiErrorBody> | null) {
    super(typeof body?.message === 'string' && body.message ? body.message : 'Something went wrong. Try again.');
    this.status = status;
    this.code = typeof body?.error === 'string' ? body.error : status === 0 ? 'offline' : 'unknown';
    this.fields = normalizeFields(body?.fields);
  }
}

/** `{id: 'msg'}` or `{id: ['msg']}` → `{id: ['msg']}`. */
export function normalizeFields(fields: ApiErrorBody['fields'] | null | undefined): Record<string, string[] | undefined> {
  const out: Record<string, string[] | undefined> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') out[k] = [v];
    else if (Array.isArray(v)) out[k] = v.filter((m): m is string => typeof m === 'string');
  }
  return out;
}

/** `fetch` for the respondent routes: this site only, with the render token on writes. */
export function respondentFetch(url: string, init: RequestInit = {}, renderToken?: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (renderToken) headers.set(RENDER_HEADER, renderToken);
  return fetch(url, {...init, headers, credentials: 'same-origin'});
}

async function call<T>(url: string, init: RequestInit, renderToken?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await respondentFetch(url, init, renderToken);
  } catch {
    throw new PublicApiError(0, null);
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new PublicApiError(res.status, data as ApiErrorBody | null);
  return data as T;
}

const JSON_HEADERS = {'content-type': 'application/json'};

export function fetchForm(slug: string, unlockToken?: string | null): Promise<PublicFormResponse> {
  return call(publicFormPath(slug), {headers: unlockToken ? {[UNLOCK_HEADER]: unlockToken} : undefined});
}

/** `renderToken`: the one the locked form came with (the server checks it before the password). */
export function unlockForm(slug: string, password: string, renderToken: string): Promise<UnlockResponse> {
  return call(`${publicFormPath(slug)}/unlock`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({password})}, renderToken);
}

export function submitResponse(slug: string, input: SubmitInput): Promise<SubmitResponse> {
  return call(`${publicFormPath(slug)}/responses`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input)}, input.renderToken);
}

/**
 * Funnel event ("view" / "start"), fire and forget. A keepalive fetch rather than sendBeacon:
 * a beacon cannot carry the render-token header.
 */
export function sendEvent(slug: string, type: FormEventType, session: string, renderToken: string): void {
  void respondentFetch(
    `${publicFormPath(slug)}/events`,
    {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({type, session}), keepalive: true},
    renderToken
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Storage: wrapped, because Safari throws inside some iframes (WebKit bug 299531).

export function storageGet(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(store: 'local' | 'session', key: string, value: string): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    // storage blocked: the feature degrades, the form still works
  }
}

/** A random uuid (crypto.randomUUID needs a secure context; fall back to getRandomValues). */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A submit id: 16 random bytes, base64url (22 characters; the server accepts 16–64 of [A-Za-z0-9_-]). */
export function newSubmissionId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The id of the fill in progress. Every try of the same fill sends the same id (a failed or
 * lost submit, pressed again), so the server saves it once; only a saved fill starts a new one.
 */
export class FillId {
  #id: string | null = null;
  get(): string {
    return (this.#id ??= newSubmissionId());
  }
  /** The fill was saved: the next one gets a new id. */
  done(): void {
    this.#id = null;
  }
}

/** One uuid per form per browser session, for view/start dedupe. */
export function sessionToken(formId: string): string {
  const key = `if_s_${formId}`;
  let t = storageGet('session', key);
  if (!t) {
    t = newUuid();
    storageSet('session', key, t);
  }
  return t;
}

/** Reads one cookie by name from a `document.cookie` string. */
export function readCookieValue(cookies: string, name: string): string | null {
  const hit = cookies.split('; ').find(c => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) || null : null;
}

/** The one-response-per-browser token, if this browser already responded. */
export function storedBrowserToken(formId: string): string | null {
  const name = `if_r_${formId}`;
  let cookie: string | null = null;
  try {
    cookie = readCookieValue(document.cookie, name);
  } catch {
    // cookies blocked
  }
  return cookie || storageGet('local', name);
}

export function rememberBrowserToken(formId: string, token: string): void {
  const name = `if_r_${formId}`;
  try {
    document.cookie = `${name}=${token}; Max-Age=31536000; Path=/f/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {
    // cookies blocked
  }
  storageSet('local', name, token);
}
