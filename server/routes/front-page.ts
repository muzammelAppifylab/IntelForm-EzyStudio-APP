import { Hono } from 'hono'
import {
  frontPagePatch,
  readFrontPage,
  type FeaturedFormView,
  type FrontPageContent,
  type FrontPageView,
  type PickableFormsResponse,
  type PublicFormCard,
} from '../../shared/api-front'
import { sql, type Queryable } from '../db/client'
import { ApiError } from '../lib/errors'
import { getSetting } from '../lib/settings'
import { esc } from '../respondent/inline'
import { readBody } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

/**
 * Front page editor (PRD "Front page editor"): Owner and Editors edit, Viewers read.
 *
 * Content lives in app_settings key `front_page`. Which forms are featured lives on each form
 * (`settings.showOnFrontPage`, `settings.frontPageDescription`, the Share tab's fields), so the
 * Share tab and this editor never disagree; the key keeps only their order (`featuredOrder`).
 */
export const frontPageRoutes = new Hono<AppEnv>().use(requireUser)

const KEY = 'front_page'

interface StoredFrontPage {
  content: FrontPageContent
  featuredOrder: string[]
}

export async function loadFrontPage(tx: Queryable = sql): Promise<StoredFrontPage> {
  const [row] = await tx<{ value: Record<string, unknown> | null }[]>`SELECT value FROM app_settings WHERE key = ${KEY}`
  const value = row?.value ?? {}
  const order = Array.isArray(value.featuredOrder) ? value.featuredOrder.filter((v): v is string => typeof v === 'string') : []
  return { content: readFrontPage(value), featuredOrder: order }
}

async function saveFrontPage(tx: Queryable, stored: StoredFrontPage): Promise<void> {
  const value = { ...stored.content, featuredOrder: stored.featuredOrder }
  await tx`
    INSERT INTO app_settings (key, value) VALUES (${KEY}, ${tx.json(value as never)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `
}

/** Sorts rows by the stored order; anything not in it (featured from the Share tab) goes last, by title. */
function byOrder<T extends { id: string; title: string }>(rows: T[], order: string[]): T[] {
  const pos = new Map(order.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || a.title.localeCompare(b.title))
}

interface FeaturedRow {
  id: string
  title: string
  slug: string
  status: 'draft' | 'live' | 'closed'
  description: string | null
  minutes: number | null
  is_public: boolean
}

/**
 * Live and accepting responses. A close date already passed counts as closed even before the
 * scheduler flips the status, so the card never outlives the form.
 */
const isPublic = sql`(
  f.status = 'live' AND f.published_version_id IS NOT NULL
  AND (f.settings->>'closed') IS DISTINCT FROM 'true'
  AND ((f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') > now())
)`

/** Start-screen minutes from the published version (the draft's while unpublished). */
const minutesExpr = sql`
  CASE WHEN jsonb_typeof(COALESCE(v.definition, f.draft)->'startScreen'->'minutes') = 'number'
       THEN (COALESCE(v.definition, f.draft)->'startScreen'->>'minutes')::int END
`

async function featuredRows(tx: Queryable, publicOnly: boolean): Promise<FeaturedRow[]> {
  return tx<FeaturedRow[]>`
    SELECT f.id, f.title, f.slug, f.status, f.settings->>'frontPageDescription' AS description,
           ${minutesExpr} AS minutes, ${isPublic} AS is_public
    FROM forms f
    LEFT JOIN form_versions v ON v.id = f.published_version_id
    WHERE (f.settings->>'showOnFrontPage') = 'true'
      ${publicOnly ? sql`AND ${isPublic}` : sql``}
  `
}

export async function frontPageView(tx: Queryable = sql): Promise<FrontPageView> {
  const stored = await loadFrontPage(tx)
  const rows = byOrder(await featuredRows(tx, false), stored.featuredOrder)
  return {
    content: stored.content,
    featured: rows.map<FeaturedFormView>((r) => ({
      formId: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      description: r.description ?? '',
      minutes: r.minutes,
      isPublic: r.is_public,
    })),
  }
}

/** The cards on the public page: featured, Live forms only, in the editor's order. */
export async function publicFormCards(order: string[], tx: Queryable = sql): Promise<PublicFormCard[]> {
  const rows = byOrder(await featuredRows(tx, true), order)
  return rows.map((r) => ({ title: r.title, slug: r.slug, description: r.description ?? '', minutes: r.minutes }))
}

frontPageRoutes.get('/', requirePermission('forms.view'), async (c) => c.json<FrontPageView>(await frontPageView()))

/** Live forms to pick from. */
frontPageRoutes.get('/forms', requirePermission('forms.view'), async (c) => {
  const rows = await sql<{ id: string; title: string; slug: string; description: string | null; minutes: number | null; featured: boolean }[]>`
    SELECT f.id, f.title, f.slug, f.settings->>'frontPageDescription' AS description, ${minutesExpr} AS minutes,
           (f.settings->>'showOnFrontPage') = 'true' AS featured
    FROM forms f
    LEFT JOIN form_versions v ON v.id = f.published_version_id
    WHERE ${isPublic}
    ORDER BY lower(f.title), f.created_at
    LIMIT 500
  `
  return c.json<PickableFormsResponse>({
    forms: rows.map((r) => ({ ...r, description: r.description ?? '', featured: !!r.featured })),
  })
})

frontPageRoutes.patch('/', requirePermission('frontPage.edit'), async (c) => {
  const { featured, ...content } = await readBody(c, frontPagePatch)

  const view = await sql.begin(async (tx) => {
    // One editor save at a time, so two saves can't interleave their form updates.
    await tx`SELECT pg_advisory_xact_lock(hashtext('intelform:front_page'))`
    const stored = await loadFrontPage(tx)
    const next: StoredFrontPage = { content: { ...stored.content, ...content }, featuredOrder: stored.featuredOrder }

    if (featured) {
      const ids = featured.map((f) => f.formId)
      const known = ids.length
        ? await tx<{ id: string; featured: boolean; public: boolean }[]>`
            SELECT f.id, (f.settings->>'showOnFrontPage') = 'true' AS featured, ${isPublic} AS public
            FROM forms f WHERE f.id IN ${tx(ids)}
          `
        : []
      const byId = new Map(known.map((k) => [k.id, k]))
      const fieldErrors: string[] = []
      for (const id of ids) {
        const k = byId.get(id)
        if (!k) fieldErrors.push('One of the featured forms was deleted. Remove it and save again.')
        // Only Live forms can be added; one already featured may stay while it's closed.
        else if (!k.featured && !k.public) fieldErrors.push('Only Live forms can be featured. Publish the form first.')
      }
      if (fieldErrors.length) throw new ApiError(422, 'validation_failed', fieldErrors[0], { featured: [fieldErrors[0]] })

      // Forms left out stop being featured (the Share tab's toggle follows).
      await tx`
        UPDATE forms SET settings = settings || '{"showOnFrontPage": false}'::jsonb
        WHERE (settings->>'showOnFrontPage') = 'true'
          ${ids.length ? tx`AND id NOT IN ${tx(ids)}` : tx``}
      `
      for (const f of featured) {
        await tx`
          UPDATE forms SET settings = settings || jsonb_build_object('showOnFrontPage', true, 'frontPageDescription', ${f.description}::text)
          WHERE id = ${f.formId}
        `
      }
      next.featuredOrder = ids
    }

    await saveFrontPage(tx, next)
    return frontPageView(tx)
  })
  return c.json<FrontPageView>(view)
})

/**
 * Production HTML for `/`: the app shell with the front page's title, description, Open Graph
 * and robots tags filled in, so crawlers and link previews see them without running JavaScript
 * (HomePage.tsx sets the same tags in the browser). Off or not indexable → noindex.
 *
 * The tags carry `data-ssr` and sit before the shell's own <title>, so crawlers read them first;
 * main.tsx removes them at start-up, leaving the tags React renders as the only ones.
 */
export function injectHomeMeta(shell: string, content: FrontPageContent, appName: string, origin: string): { html: string; noindex: boolean } {
  if (!content.enabled) return { html: shell, noindex: true }
  const title = content.seo.title || content.hero.headline || appName
  const description = content.seo.description || content.hero.text.slice(0, 160)
  const ogImage = content.seo.ogImage ? new URL(content.seo.ogImage, origin).href : null
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
    !content.seo.indexing && '<meta name="robots" content="noindex">',
  ]
    .filter((t): t is string => !!t)
    .map((t) => t.replace(/^<(\w+)/, '<$1 data-ssr'))
  // After the charset declaration when there is one, else at the top of <head>.
  const at = /<meta charset[^>]*>/i.test(shell) ? /<meta charset[^>]*>/i : /<head>|<head [^>]*>/
  const html = shell.replace(at, (tag) => `${tag}\n${head.join('\n')}`)
  return { html, noindex: !content.seo.indexing }
}

export async function renderHomePage(shell: string, origin: string): Promise<{ html: string; noindex: boolean }> {
  const [{ content }, { appName }] = await Promise.all([loadFrontPage(), getSetting('general')])
  return injectHomeMeta(shell, content, appName, origin)
}
