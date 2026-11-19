import type {LegalKind, PublicAppInfo, PublicFormCard, PublicHome, PublicLegal} from '../../../lib/intelform/api-front';
import {LEGAL_KINDS, LEGAL_TITLE} from '../../../lib/intelform/api-front';
import {formHref, FORMS_PAGE_SIZE, type PublicFormsPage, SEARCH_MAX} from './common';
import {COLOR_MODES, type ColorMode, DATE_FORMATS, type DateFormat} from '../../../lib/intelform/settings-app';

/**
 * The public site's data shapes (home, /forms/, About, Privacy and Terms) and the pure steps that
 * build them. No server imports, so the unit tests run without a database. The static pages'
 * browser scripts import ./common instead (small: no zod).
 *
 * Which forms the site lists lives on each form (`settings.showOnFrontPage` and
 * `frontPageDescription`, the Share tab's Homepage card). A form is listed while it is Live,
 * published, not closed, and its close date (if any) has not passed.
 */

export {formHref, formsCountText, FORMS_PAGE_SIZE, HOME_FORMS, LISTED_FORMS_MAX, type PublicFormsPage, SEARCH_MAX} from './common';

/** One listed form as it is cached: the card plus its close date, checked on every request. */
export interface ListedForm extends PublicFormCard {
  /** ISO date the form closes on its own, or null. */
  closeAt: string | null;
}

/** The public parts of the app settings the public site shows (from the cached `getAppSettings`). */
export interface PublicSettings {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  accentColor: string | null;
  defaultMode: string;
  dateFormat: string;
  indexing: boolean;
  description: string;
  ogImage: string | null;
  contactEmail: string;
  hasPrivacy: boolean;
  hasTerms: boolean;
}

/** GET /site-api/public-site/legal/:kind, plus the indexing flag the static page applies. */
export interface PublicLegalPage extends PublicLegal {
  indexing: boolean;
}

/** GET /site-api/public-site/sitemap: what /sitemap.xml lists from the database. */
export interface PublicSitemap {
  indexing: boolean;
  hasPrivacy: boolean;
  hasTerms: boolean;
  /** Open forms that allow search engines (`settings.noindex` off), newest first. */
  forms: {slug: string; lastmod: string}[];
}

/** A raw card row (tagged SQL) → the cached shape. */
export function listedFormFromRow(row: {
  title: string;
  slug: string;
  description: string | null;
  minutes: number | null;
  close_at: Date | string | null;
}): ListedForm {
  const minutes = typeof row.minutes === 'number' && Number.isFinite(row.minutes) && row.minutes > 0 ? Math.round(row.minutes) : null;
  const closeAt = row.close_at === null ? null : new Date(row.close_at);
  return {
    title: row.title,
    slug: row.slug,
    description: row.description ?? '',
    minutes,
    closeAt: closeAt && !Number.isNaN(closeAt.getTime()) ? closeAt.toISOString() : null,
  };
}

/**
 * The forms still open at `now`. The list is cached for a few minutes, so a close date that passes
 * meanwhile is checked here, on every request: the card never outlives the form.
 */
export function openNow(forms: ListedForm[], now: Date = new Date()): PublicFormCard[] {
  const at = now.getTime();
  return forms
    .filter(f => f.closeAt === null || new Date(f.closeAt).getTime() > at)
    .map(f => ({title: f.title, slug: f.slug, description: f.description, minutes: f.minutes}));
}

/** GET /home: what every public page needs. */
export function publicHome(settings: PublicSettings, forms: PublicFormCard[]): PublicHome {
  return {
    appName: settings.appName,
    logoUrl: settings.logoUrl,
    forms,
    description: settings.description,
    ogImage: settings.ogImage,
    contactEmail: settings.contactEmail,
    indexing: settings.indexing,
    hasPrivacy: settings.hasPrivacy,
    hasTerms: settings.hasTerms,
  };
}

/** GET /app: the app name and branding (no secrets). */
export function publicAppInfo(settings: PublicSettings, emailEnabled: boolean): PublicAppInfo {
  return {
    appName: settings.appName,
    logoUrl: settings.logoUrl,
    emailEnabled,
    faviconUrl: settings.faviconUrl,
    accentColor: settings.accentColor && /^#[0-9a-fA-F]{6}$/.test(settings.accentColor) ? settings.accentColor : null,
    defaultMode: (COLOR_MODES as readonly string[]).includes(settings.defaultMode) ? (settings.defaultMode as ColorMode) : 'system',
    dateFormat: (DATE_FORMATS as readonly string[]).includes(settings.dateFormat) ? (settings.dateFormat as DateFormat) : 'DD/MM/YYYY',
  };
}

export function isLegalKind(kind: string): kind is LegalKind {
  return (LEGAL_KINDS as readonly string[]).includes(kind);
}

/** GET /legal/:kind */
export function publicLegal(kind: LegalKind, appName: string, text: string, indexing: boolean): PublicLegalPage {
  return {kind, title: LEGAL_TITLE[kind], appName, text, indexing};
}

/** The search as typed → what is matched (trimmed, lower case, bounded), or '' for none. */
export function normalizeSearch(search: string | undefined | null): string {
  return (search ?? '').trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX).toLowerCase();
}

/**
 * One page of the listed forms: matched on title and description (legacy /forms search), in the
 * list's order (title), after the card with slug `after`. The list is at most
 * `LISTED_FORMS_MAX` cards, already in memory, so this walks it rather than asking the database again.
 */
export function formsPage(
  forms: PublicFormCard[],
  options: {search?: string | null; after?: string | null; size?: number; indexing: boolean}
): PublicFormsPage {
  const q = normalizeSearch(options.search);
  const size = options.size ?? FORMS_PAGE_SIZE;
  const matched = q ? forms.filter(f => `${f.title} ${f.description}`.toLowerCase().includes(q)) : forms;
  let start = 0;
  if (options.after) {
    const at = matched.findIndex(f => f.slug === options.after);
    // A cursor that is no longer there (the form closed meanwhile): nothing more to show.
    start = at < 0 ? matched.length : at + 1;
  }
  const rows = matched.slice(start, start + size);
  const more = start + size < matched.length;
  return {
    forms: rows,
    next: more && rows.length ? rows[rows.length - 1]!.slug : null,
    total: forms.length,
    indexing: options.indexing,
  };
}

/** The forms' URLs for the sitemap, newest first, with a valid date only. */
export function sitemapForms(rows: {slug: string; published_at: Date | string}[]): PublicSitemap['forms'] {
  return rows.flatMap(row => {
    const at = new Date(row.published_at);
    return Number.isNaN(at.getTime()) ? [] : [{slug: row.slug, lastmod: at.toISOString()}];
  });
}

/** The public site's pages that follow Settings, Public site, "Let search engines index the site". */
export const SITE_PAGES: ReadonlySet<string> = new Set(['/', '/forms/', '/privacy/', '/terms/']);

/**
 * What /sitemap.xml lists besides posts: the site's pages (the public site's own only while it may
 * be indexed; Privacy and Terms once written) and the forms. `data` null = the database could not be
 * read: the public site's pages are left out rather than listed against their noindex.
 */
export function sitemapPaths(pages: string[], data: PublicSitemap | null): {path: string; lastmod?: string}[] {
  const hidden = (path: string) => {
    if (!SITE_PAGES.has(path)) return false;
    if (!data?.indexing) return true;
    if (path === '/privacy/') return !data.hasPrivacy;
    if (path === '/terms/') return !data.hasTerms;
    return false;
  };
  return [
    ...pages.filter(path => !hidden(path)).map(path => ({path})),
    ...(data?.forms ?? []).map(form => ({path: formHref(form.slug), lastmod: form.lastmod})),
  ];
}
