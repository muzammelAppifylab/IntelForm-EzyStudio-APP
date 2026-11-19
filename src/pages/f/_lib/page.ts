import type {
  PublicFormClosed,
  PublicFormLive,
  PublicFormLocked,
  PublicFormResponse,
} from '../../../lib/intelform/api-public';
import {SYSTEM_LABELS} from '../../../lib/intelform/form/labels';
import {defaultTheme, type FormTheme} from '../../../lib/intelform/form/theme-core';
import {type EmbedOptions, embedQuery} from '../../../respondent/embed';
import {themeFontFiles} from '../../../respondent/fonts';
import {styleHash, themeCss} from '../../../respondent/theme-css';
import {ipKeyFor} from '../../../server/intelform/respondent/crypto';
import {SLUG_RE, type Db} from '../../../server/intelform/respondent/load';
import {limitedPayload, PUBLIC_GET_RATE_LIMIT} from '../../../server/intelform/respondent/page';

/**
 * Server half of the public form page (src/pages/f/[slug].astro): which state the slug is in,
 * the per-form rate limit, the <head> metadata, the theme <style> and its CSP hash. Pure apart
 * from the database reads it is handed, so the tests drive it with a fake.
 *
 * Files under `src/pages/**` whose name starts with `_` are not routes.
 */

/**
 * Page loads per caller per minute; the JSON read (/site-api/public/forms/:slug) shares the key
 * and the limit (src/server/intelform/respondent/page.ts).
 */
export {PUBLIC_GET_RATE_LIMIT};

export type FormPageState =
  | {kind: 'form'; payload: PublicFormLive | PublicFormLocked}
  | {kind: 'closed'; payload: PublicFormClosed}
  | {kind: 'moved'; slug: string}
  | {kind: 'missing'}
  | {kind: 'limited'; retryAfter: number}
  /** No database, no site secret, or the read failed: a 503, never a 404. */
  | {kind: 'unavailable'};

export interface LoadInput {
  db: Db | null;
  /** The site secret (config.jwtSecret), or null when the site isn't set up. */
  secret: string | null;
  slug: string;
  /** The caller's address as Cloudflare saw it (`cf-connecting-ip`), or null locally. */
  ip: string | null;
  now?: number;
}

/** Answers the page's question: what does this slug show right now? */
export async function loadFormPage({db, secret, slug, ip, now = Date.now()}: LoadInput): Promise<FormPageState> {
  const clean = slug.toLowerCase();
  // A malformed slug is a plain 404 without touching the database.
  if (!SLUG_RE.test(clean)) return {kind: 'missing'};
  if (!db || !secret) return {kind: 'unavailable'};
  try {
    // The form from the Site Cache, then ONE statement: the limit's hit and, for a capped form,
    // its exact count. A cache miss reads the form first (one more trip).
    const out = await limitedPayload(db, secret, await ipKeyFor(secret, ip), clean, null, now);
    if (out.kind === 'limited') return {kind: 'limited', retryAfter: out.retryAfter};
    return stateOf(out.payload);
  } catch {
    return {kind: 'unavailable'};
  }
}

export function stateOf(payload: PublicFormResponse | null): FormPageState {
  if (!payload) return {kind: 'missing'};
  if (payload.status === 'moved') return {kind: 'moved', slug: payload.redirectTo};
  if (payload.status === 'closed') return {kind: 'closed', payload};
  return {kind: 'form', payload};
}

/** HTTP status per state. */
export function statusOf(state: FormPageState): number {
  switch (state.kind) {
    case 'form':
    case 'closed':
      return 200;
    case 'moved':
      return 301;
    case 'missing':
      return 404;
    case 'limited':
      return 429;
    case 'unavailable':
      return 503;
  }
}

/** Where an old slug points, keeping only the embed options of the query. */
export function movedLocation(slug: string, opts: EmbedOptions): string {
  return `/f/${encodeURIComponent(slug)}/${embedQuery(opts)}`;
}

export interface PageMeta {
  title: string;
  description: string | null;
  ogImage: string | null;
  noindex: boolean;
  /** The message screen the server draws (closed, missing, limited, unavailable), or null for the island. */
  message: {title: string; body?: string} | null;
  theme: FormTheme;
  center: boolean;
}

/** <head> and server-drawn screen for a state. Every state but a live, indexable form is noindex. */
export function pageMeta(state: FormPageState, opts: EmbedOptions): PageMeta {
  const base = {ogImage: null, description: null, noindex: true, theme: defaultTheme(), center: false};
  switch (state.kind) {
    case 'form':
    case 'closed': {
      const p = state.payload;
      const s = p.settings;
      return {
        title: s.seoTitle || p.title,
        description: s.seoDescription || null,
        ogImage: s.ogImage,
        // Embeds and closed forms never rank; otherwise the form's own setting.
        noindex: s.noindex || state.kind === 'closed' || opts.embed !== null,
        message: state.kind === 'closed' ? {title: state.payload.message || SYSTEM_LABELS.closed} : null,
        theme: p.theme,
        center: p.theme.alignment === 'center',
      };
    }
    case 'missing':
    case 'moved':
      return {...base, title: SYSTEM_LABELS.formMissingTitle, message: {title: SYSTEM_LABELS.formMissingTitle, body: SYSTEM_LABELS.formMissing}};
    case 'limited':
      return {...base, title: 'Too many requests', message: {title: 'Too many requests', body: 'Wait a minute and reload the page.'}};
    case 'unavailable':
      return {...base, title: SYSTEM_LABELS.loadErrorTitle, message: {title: SYSTEM_LABELS.loadErrorTitle, body: SYSTEM_LABELS.loadError}};
  }
}

/** The theme <style> text and its CSP hash. Transparent embeds leave the page background clear. */
export async function themeStyle(theme: FormTheme): Promise<{css: string; hash: `sha256-${string}`}> {
  const css = themeCss(theme, '.rf-page');
  return {css, hash: await styleHash(css)};
}

/** Font files to preload for the theme. */
export const fontPreloads = (theme: FormTheme) => themeFontFiles(theme);

/** The parts of Astro's CSP API the page uses. */
export interface PageCsp {
  // Method syntax on purpose: Astro's own parameter types are narrower template literals.
  insertDirective(directive: `frame-ancestors ${string}` | `frame-src ${string}`): void;
  insertScriptResource(resource: string): void;
  insertStyleHash(hash: `sha256-${string}`): void;
}

/**
 * Any site may frame /f/* (the embed). A CSP `frame-ancestors` in the response header wins over
 * the template's `X-Frame-Options: DENY` in every current browser (CSP Level 2+: when
 * frame-ancestors is present, X-Frame-Options is ignored).
 */
export function allowFraming(csp: PageCsp | undefined, headers?: Headers): void {
  csp?.insertDirective('frame-ancestors *');
  // Astro sends this page's CSP as a <meta> tag, and browsers IGNORE frame-ancestors in a meta
  // CSP, so the template's `X-Frame-Options: DENY` header would still block every embed. A real
  // CSP header carrying only frame-ancestors makes browsers ignore X-Frame-Options (CSP Level 2+).
  headers?.set('Content-Security-Policy', 'frame-ancestors *');
}
