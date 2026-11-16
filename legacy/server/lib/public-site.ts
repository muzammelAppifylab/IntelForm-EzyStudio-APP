import type { PublicFormCard } from '../../shared/api-front'
import { sql, type Queryable } from '../db/client'
import { esc } from '../respondent/inline'
import { getSetting, type AppSettings } from './settings'

/**
 * The public site (home, About, Forms, Privacy, Terms). Its pages are code in src/pages/public;
 * the server supplies the listed forms and, for `/`, the search and sharing tags.
 */

/**
 * Live and accepting responses. A close date already passed counts as closed even before the
 * scheduler flips the status, so the card never outlives the form.
 */
const isPublic = sql`(
  f.status = 'live' AND f.published_version_id IS NOT NULL
  AND (f.settings->>'closed') IS DISTINCT FROM 'true'
  AND ((f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') > now())
)`

/** The forms turned on in their Share tab's Homepage card, Live only, by title. */
export async function publicFormCards(tx: Queryable = sql): Promise<PublicFormCard[]> {
  const rows = await tx<{ title: string; slug: string; description: string | null; minutes: number | null }[]>`
    SELECT f.title, f.slug, f.settings->>'frontPageDescription' AS description,
           CASE WHEN jsonb_typeof(v.definition->'startScreen'->'minutes') = 'number'
                THEN (v.definition->'startScreen'->>'minutes')::int END AS minutes
    FROM forms f
    JOIN form_versions v ON v.id = f.published_version_id
    WHERE (f.settings->>'showOnFrontPage') = 'true' AND ${isPublic}
    ORDER BY lower(f.title), f.created_at
    LIMIT 200
  `
  return rows.map((r) => ({ title: r.title, slug: r.slug, description: r.description ?? '', minutes: r.minutes }))
}

/**
 * Production HTML for `/`: the app shell with the site's title, description, Open Graph and
 * robots tags filled in, so crawlers and link previews see them without running JavaScript
 * (HomePage.tsx sets the same tags in the browser). Not indexable → noindex.
 *
 * The tags carry `data-ssr` and sit before the shell's own <title>, so crawlers read them first;
 * main.tsx removes them at start-up, leaving the tags React renders as the only ones.
 */
export function injectHomeMeta(shell: string, site: AppSettings['site'], appName: string, origin: string): { html: string; noindex: boolean } {
  const title = appName
  const description = site.description
  const ogImage = site.ogImage ? new URL(site.ogImage, origin).href : null
  const head = [
    `<title>${esc(title)}</title>`,
    description && `<meta name="description" content="${esc(description)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(title)}">`,
    description && `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(origin + '/')}">`,
    `<meta property="og:site_name" content="${esc(appName)}">`,
    ogImage && `<meta property="og:image" content="${esc(ogImage)}">`,
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
    !site.indexing && '<meta name="robots" content="noindex">',
  ]
    .filter((t): t is string => !!t)
    .map((t) => t.replace(/^<(\w+)/, '<$1 data-ssr'))
  // After the charset declaration when there is one, else at the top of <head>.
  const at = /<meta charset[^>]*>/i.test(shell) ? /<meta charset[^>]*>/i : /<head>|<head [^>]*>/
  const html = shell.replace(at, (tag) => `${tag}\n${head.join('\n')}`)
  return { html, noindex: !site.indexing }
}

export async function renderHomePage(shell: string, origin: string): Promise<{ html: string; noindex: boolean }> {
  const [site, { appName }] = await Promise.all([getSetting('site'), getSetting('general')])
  return injectHomeMeta(shell, site, appName, origin)
}

/** Whether search engines may index the site's pages (Settings → Public site). */
export async function siteIndexable(): Promise<boolean> {
  return (await getSetting('site')).indexing
}
