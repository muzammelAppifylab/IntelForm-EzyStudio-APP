import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {config} from '../../../platform/config';
import type {PublicFormResponse} from '../../../lib/intelform/api-public';
import {exactResponsesSql} from '../forms/counts';
import {loadPublishedBySlug} from './cache';
import {ipKeyFor} from './crypto';
import {needsCount, needsHash, publishedPayload, type Db, type FormState} from './load';
import {retryAfter} from './rate-limit';

/**
 * The respondent page `/f/[slug]` (an SSR Astro page) loads its form IN-PROCESS with
 * `loadPublicForm()` and inlines the JSON (`<script type="application/json" id="__FORM__">`
 * with `safeJson`), so the form renders without a second round trip. A JSON data block is not
 * executed, so the CSP needs no hash for it.
 */

/** Public GETs per IP per minute, across all forms: enough for any person, not for a scraper. */
// Generous: a school, office or event Wi-Fi shares one address, and its people all open the form
// in the same minute. It only stops one caller hammering the site (the page is mostly cached).
export const PUBLIC_GET_RATE_LIMIT = 1000;
export const PUBLIC_GET_MESSAGE = 'Too many requests. Wait a minute and try again.';

export const PUBLIC_GET_WINDOW = 60;
export const publicGetKey = (ipKey: string) => `public-form:${ipKey}`;

/**
 * Counts one hit on `key` and, when `formId` is given, reads what the cache leaves out of that
 * form (its exact count, its password hash): ONE statement, one round trip. `state` is undefined
 * without a form id, null when the form is gone.
 */
export async function hitWithState(
  db: Pick<PrismaClient, '$queryRaw'>,
  key: string,
  windowSeconds: number,
  formId: string | null
): Promise<{count: number; state: FormState | null | undefined}> {
  const rows = await db.$queryRaw<{count: number; found: boolean; responses: number | null; password_hash: string | null}[]>`
    WITH rl AS (
      INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
      VALUES (${key}, date_bin(make_interval(secs => ${windowSeconds}::int), now(), 'epoch'), ${windowSeconds}::int, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
      RETURNING count
    )
    SELECT rl.count, f.id IS NOT NULL AS found,
      ${formId ? exactResponsesSql(Prisma.sql`f.id`) : Prisma.sql`NULL::int`} AS responses,
      f.settings->>'passwordHash' AS password_hash
    FROM rl LEFT JOIN forms f ON f.id = ${formId}::uuid
  `;
  const row = rows[0];
  const count = Number(row?.count ?? 1);
  if (!formId) return {count, state: undefined};
  return {count, state: row?.found ? {responses: Number(row.responses ?? 0), passwordHash: row.password_hash || null} : null};
}

/** The public GET of a slug, with the caller's limit. */
export type LimitedPayload = {kind: 'limited'; retryAfter: number} | {kind: 'payload'; payload: PublicFormResponse | null};

/**
 * One public form load (the /f/[slug] page and GET /site-api/public/forms/:slug) in ONE database
 * round trip when the form is in the Site Cache: the rate-limit hit and, only if the answer
 * needs it, the form's exact count (a capped form) or password hash (an unlock token to check),
 * in one statement. A cache miss reads the form first (one more trip). A 429 wins over whatever
 * the form read found.
 */
export async function limitedPayload(
  db: Db,
  secret: string,
  ipKey: string,
  slug: string,
  unlock: string | null = null,
  now = Date.now()
): Promise<LimitedPayload> {
  const r = await loadPublishedBySlug(db, slug);
  const p = r.kind === 'form' ? r.published : null;
  const formId = p && (needsCount(p) || needsHash(p, unlock)) ? p.form.id : null;
  const {count, state} = await hitWithState(db, publicGetKey(ipKey), PUBLIC_GET_WINDOW, formId);
  if (count > PUBLIC_GET_RATE_LIMIT) return {kind: 'limited', retryAfter: retryAfter(PUBLIC_GET_WINDOW, now)};
  if (r.kind === 'missing' || state === null) return {kind: 'payload', payload: null};
  if (r.kind === 'moved') return {kind: 'payload', payload: {status: 'moved', redirectTo: r.slug}};
  return {kind: 'payload', payload: await publishedPayload(db, secret, r.published, unlock, state, ipKey)};
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
  const out = await limitedPayload(db, secret, ipKey, slug, opts.unlock ?? null);
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
