import {config} from '../../../platform/config';
import type {PublicFormResponse} from '../../../lib/intelform/api-public';
import {loadPublishedBySlug} from './cache';
import {publishedPayload, type Db} from './load';

/**
 * The respondent page `/f/[slug]` (an SSR Astro page) loads its form IN-PROCESS with
 * `loadPublicForm()` and inlines the JSON (`<script type="application/json" id="__FORM__">`
 * with `safeJson`), so the form renders without a second round trip. A JSON data block is not
 * executed, so the CSP needs no hash for it.
 */

/** Kept for the GET route's 429 wording (a limit may come back); no load is limited now. */
export const PUBLIC_GET_MESSAGE = 'Too many requests. Wait a minute and try again.';

/** The public GET of a slug. */
export type LimitedPayload = {kind: 'limited'; retryAfter: number} | {kind: 'payload'; payload: PublicFormResponse | null};

/**
 * One public form load (the /f/[slug] page and GET /site-api/public/forms/:slug). The form comes
 * from the Site Cache, so a load runs NO database statement, and none that writes: the per-IP
 * page limit (a rate-limit row written on every view) is gone; loads are cheap and the writes it
 * guarded (submits, beacons) keep their own limits. Only when the answer needs it does one read
 * run: a capped form's exact count, or the password hash to check an unlock token
 * (publishedPayload). A cache miss reads the form first. `kind: 'limited'` is never returned now;
 * the type keeps it for the callers' 429 branch.
 */
export async function limitedPayload(
  db: Db,
  secret: string,
  _ipKey: string,
  slug: string,
  unlock: string | null = null,
  _now = Date.now()
): Promise<LimitedPayload> {
  const r = await loadPublishedBySlug(db, slug);
  if (r.kind === 'missing') return {kind: 'payload', payload: null};
  if (r.kind === 'moved') return {kind: 'payload', payload: {status: 'moved', redirectTo: r.slug}};
  return {kind: 'payload', payload: await publishedPayload(db, secret, r.published, unlock)};
}

export interface PublicFormPage {
  /** 200 live/closed/locked, 301 moved (`payload.redirectTo`), 404 draft or unknown, 429 rate limited, 503 not set up. */
  status: 200 | 301 | 404 | 429 | 503;
  payload: PublicFormResponse | null;
  /** Hide from search engines: missing, moved, or the form's own setting. */
  noindex: boolean;
  /** Seconds, with a 429. */
  retryAfter?: number;
  /** `<title>`, description and og:image for the page head (live, closed and locked forms). */
  head: {title: string; description: string; ogImage: string | null} | null;
}

/**
 * Everything the `/f/[slug]` page needs. `ip` is `cf-connecting-ip` (null locally);
 * `unlock` is a token the page may have (normally none: the password screen posts to /unlock).
 */
export async function loadPublicForm(
  db: Db,
  slug: string,
  opts: {ip?: string | null; unlock?: string | null} = {}
): Promise<PublicFormPage> {
  const secret = config.jwtSecret;
  if (!secret) return {status: 503, payload: null, noindex: true, head: null};
  const out = await limitedPayload(db, secret, '', slug, opts.unlock ?? null);
  if (out.kind === 'limited') return {status: 429, payload: null, noindex: true, retryAfter: out.retryAfter, head: null};
  const payload = out.payload;
  if (!payload) return {status: 404, payload: null, noindex: true, head: null};
  if (payload.status === 'moved') return {status: 301, payload, noindex: true, head: null};
  const s = payload.settings;
  return {
    status: 200,
    payload,
    noindex: s.noindex,
    head: {title: s.seoTitle || payload.title, description: s.seoDescription, ogImage: s.ogImage},
  };
}

/** JSON that can sit inside <script type="application/json">: no "</script", no comment openers, no line separators. */
export const safeJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
