import type {PrismaClient} from '../../../generated/prisma/client';
import {config} from '../../../platform/config';
import type {PublicFormResponse} from '../../../lib/intelform/api-public';
import {ipKeyFor} from './crypto';
import {RespondentError} from './errors';
import {payloadForSlug, type Db} from './load';
import {rateLimit} from './rate-limit';

/**
 * The respondent page `/f/[slug]` (an SSR Astro page) loads its form IN-PROCESS with
 * `loadPublicForm()` and inlines the JSON (`<script type="application/json" id="__FORM__">`
 * with `safeJson`), so the form renders without a second round trip. A JSON data block is not
 * executed, so the CSP needs no hash for it.
 */

/** Public GETs per IP per minute, across all forms: enough for any person, not for a scraper. */
export const PUBLIC_GET_RATE_LIMIT = 300;
export const PUBLIC_GET_MESSAGE = 'Too many requests. Wait a minute and try again.';

/**
 * Counts one public form load against the caller's per-minute budget; throws a 429
 * RespondentError past it. The JSON route and the /f/[slug] page share the key.
 */
export function limitPublicGet(db: Pick<PrismaClient, '$queryRaw'>, ipKey: string): Promise<void> {
  return rateLimit(db, `public-form:${ipKey}`, PUBLIC_GET_RATE_LIMIT, 60, PUBLIC_GET_MESSAGE);
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
  const ipKey = await ipKeyFor(secret, opts.ip ?? null);
  // The limit and the form in one trip.
  const [limited, payload] = await Promise.all([
    limitPublicGet(db, ipKey).then(
      () => null,
      (err: unknown) => {
        if (err instanceof RespondentError && err.status === 429) return Number(err.headers?.['Retry-After'] ?? 60);
        throw err;
      }
    ),
    payloadForSlug(db, secret, slug, opts.unlock ?? null),
  ]);
  if (limited !== null) return {status: 429, payload: null, noindex: true, retryAfter: limited, head: null};
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
