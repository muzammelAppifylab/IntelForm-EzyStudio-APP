import {Prisma} from '../../../generated/prisma/client';
import type {LegalKind} from '../../../lib/intelform/api-front';
import {cache} from '../../../platform/cache';
import type {PrismaClient} from '../../../platform/db';
import {type CachedAppSettings, getAppSettings, getLegalText} from '../settings';
import {
  LISTED_FORMS_MAX,
  type ListedForm,
  listedFormFromRow,
  type PublicSettings,
  type PublicSitemap,
  sitemapForms,
} from './shape';

/**
 * SERVER: the public site's reads (legacy server/lib/public-site.ts).
 *
 * The settings (name, logo, search, contact, legal texts) come ONLY through the app settings'
 * cached reads (src/server/intelform/settings: `intelform:settings:*`, 7 days, cleared when
 * Settings are saved). The forms list is this module's own key (docs/agent/cache.md):
 *
 *   intelform:public-site:forms   5 min   the forms listed on the site (≤ 200 cards + close dates)
 *
 * The same for every visitor (no viewer, no drafts: only published, Live forms). A short TTL,
 * because the writes behind it live in the forms routes (publish, close, reopen, delete, slug and
 * Share settings), which call `clearPublicSiteCache()` after they saved. A close date that passes
 * is checked per request (`openNow`), never cached.
 */

const PREFIX = 'intelform:public-site:';
const FORMS_KEY = `${PREFIX}forms`;
const FORMS_TTL = 5 * 60;

/** Call after a form the public site may list changed, after the save, outside the transaction. */
export async function clearPublicSiteCache(): Promise<void> {
  await cache.delPrefix(PREFIX);
}

/**
 * Live and accepting responses. A close date already passed counts as closed even before the
 * scheduler flips the status. `f` is `forms`.
 */
const IS_OPEN = Prisma.sql`(
  f.status = 'live' AND f.published_version_id IS NOT NULL
  AND (f.settings->>'closed') IS DISTINCT FROM 'true'
  AND (intelform_try_timestamptz(f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') > now())
)`;

/** The app settings' cached shape → what the public site shows. */
export function publicSettingsOf(s: CachedAppSettings): PublicSettings {
  return {
    appName: s.appName,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
    accentColor: s.accentColor,
    defaultMode: s.defaultMode,
    dateFormat: s.dateFormat,
    indexing: s.siteIndexing,
    description: s.siteDescription,
    ogImage: s.siteOgImage,
    contactEmail: s.contactEmail,
    hasPrivacy: s.hasPrivacy,
    hasTerms: s.hasTerms,
  };
}

/** The public settings (cached by the app settings module). */
export async function publicSettings(db: PrismaClient): Promise<PublicSettings> {
  return publicSettingsOf(await getAppSettings(db));
}

/** The forms turned on in their Share tab's Homepage card, Live and open, by title. One query. */
export async function loadListedForms(db: PrismaClient): Promise<ListedForm[]> {
  const rows = await db.$queryRaw<
    {title: string; slug: string; description: string | null; minutes: number | null; close_at: Date | null}[]
  >`
    SELECT f.title, f.slug, f.settings->>'frontPageDescription' AS description,
           CASE WHEN jsonb_typeof(v.definition->'startScreen'->'minutes') = 'number'
                THEN round((v.definition->'startScreen'->>'minutes')::numeric)::int END AS minutes,
           intelform_try_timestamptz(f.settings->>'closeAt') AS close_at
    FROM forms f
    JOIN form_versions v ON v.id = f.published_version_id
    WHERE (f.settings->>'showOnFrontPage') = 'true' AND ${IS_OPEN}
    ORDER BY lower(f.title), f.created_at
    LIMIT ${LISTED_FORMS_MAX}
  `;
  return rows.map(listedFormFromRow);
}

export function listedForms(db: PrismaClient): Promise<ListedForm[]> {
  return cache.getOrSet(FORMS_KEY, FORMS_TTL, () => loadListedForms(db));
}

/** One legal text and what its page needs besides (both cached by the app settings module). */
export async function legalPage(db: PrismaClient, kind: LegalKind): Promise<{appName: string; text: string; indexing: boolean}> {
  const [settings, text] = await Promise.all([getAppSettings(db), getLegalText(db, kind)]);
  return {appName: settings.appName, text, indexing: settings.siteIndexing};
}

/** The open forms that allow search engines (their own `noindex` off), for /sitemap.xml. */
export async function loadSitemapForms(db: PrismaClient): Promise<PublicSitemap['forms']> {
  const rows = await db.$queryRaw<{slug: string; published_at: Date}[]>`
    SELECT f.slug, v.published_at
    FROM forms f
    JOIN form_versions v ON v.id = f.published_version_id
    WHERE (f.settings->>'noindex') = 'false' AND ${IS_OPEN}
    ORDER BY v.published_at DESC
    LIMIT 1000
  `;
  return sitemapForms(rows);
}
