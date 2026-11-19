import type {PrismaClient} from '../../../platform/db';
import {cache} from '../../../platform/cache';
import {config} from '../../../platform/config';
import {themePreset} from '../../../lib/intelform/form/theme-core';
import {markFormsForZone} from '../summary/marks';
import type {AppSettingsResponse} from './view';
import {
  type AppSettingsPatch,
  type AppSettingsRow,
  COLOR_MODES,
  type ColorMode,
  DATE_FORMATS,
  type DateFormat,
  defaultAppSettings,
  settingsPatchData,
  settingsView,
} from '../../../lib/intelform/settings-app';
import {DAY_BELOW_HOUR, readSpamSettings} from '../../../lib/intelform/spam';

/**
 * IntelForm's app settings on the server: the one `intelform_settings` row (id = 1), read through
 * the Site Cache (docs/agent/cache.md) and cleared on every save.
 *
 * Who reads them: every public page (app name, logo, favicon, indexing, description, the footer's
 * Privacy / Terms links), every public form (app name), the dashboard shell
 * (accent colour, default mode), new forms (default theme, time zone). The answer is the same for
 * every visitor and only the App settings screen writes the row (`saveAppSettings` below), so the
 * cache keeps it 7 days and the save clears it.
 *
 * Keys (one prefix, `intelform:settings:`, cleared together):
 *   intelform:settings:main            everything but the legal texts and the reply-to address
 *   intelform:settings:legal:privacy   the Privacy policy text (up to 50,000 characters)
 *   intelform:settings:legal:terms     the Terms text
 * The legal texts are kept apart so every public page doesn't carry 100 KB of text it doesn't
 * show. The reply-to address is not cached (an email address: cache.md "Never cache"): the
 * code that sends an email reads it with `getEmailDefaults` from the database.
 *
 * The App settings screen itself reads the database (`loadSettingsView`), never the cache.
 */

const DAY = 86_400;
export const SETTINGS_CACHE_PREFIX = 'intelform:settings:';
export const SETTINGS_MAIN_KEY = `${SETTINGS_CACHE_PREFIX}main`;
export const legalCacheKey = (kind: 'privacy' | 'terms') => `${SETTINGS_CACHE_PREFIX}legal:${kind}`;

/** Every column the settings view is built from (never `select: undefined`, never the timestamps). */
export const SETTINGS_ROW_SELECT = {
  appName: true,
  logoUrl: true,
  faviconUrl: true,
  timezone: true,
  dateFormat: true,
  accentColor: true,
  defaultMode: true,
  defaultThemeId: true,
  retentionDays: true,
  siteIndexing: true,
  siteDescription: true,
  siteOgImage: true,
  contactEmail: true,
  privacyText: true,
  termsText: true,
  emailFromName: true,
  emailReplyTo: true,
  spamLimits: true,
} as const;

/** The row as it is before anyone saved anything (the migration inserts it with these defaults). */
export function defaultSettingsRow(): AppSettingsRow {
  const d = defaultAppSettings();
  return {
    appName: d.general.appName,
    logoUrl: null,
    faviconUrl: null,
    timezone: d.general.timezone,
    dateFormat: d.general.dateFormat,
    accentColor: null,
    defaultMode: d.branding.defaultMode,
    defaultThemeId: null,
    retentionDays: null,
    siteIndexing: false,
    siteDescription: '',
    siteOgImage: null,
    contactEmail: '',
    privacyText: '',
    termsText: '',
    emailFromName: null,
    emailReplyTo: null,
    spamLimits: {},
  };
}

/**
 * Whether emails go out right now: the platform relays them with the Site Key (on your own
 * machine they are printed in the terminal instead, `src/platform/auth/email.ts`).
 */
export function emailEnabled(): boolean {
  return Boolean(config.siteKey) || config.localDev;
}

// ---------------------------------------------------------------------------
// The App settings screen (database, never the cache)
// ---------------------------------------------------------------------------

export async function loadSettingsRow(db: PrismaClient): Promise<AppSettingsRow> {
  const row = await db.intelformSettings.findUnique({where: {id: 1}, select: SETTINGS_ROW_SELECT});
  return row ?? defaultSettingsRow();
}

/** Row → what GET / PATCH answer. */
export function viewOf(row: AppSettingsRow): AppSettingsResponse {
  return settingsView(row, {emailEnabled: emailEnabled()});
}

export async function loadSettingsView(db: PrismaClient): Promise<AppSettingsResponse> {
  return viewOf(await loadSettingsRow(db));
}

/** A saved-theme id must still exist; a preset id must be a known preset. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SettingsFieldErrors = Record<string, string>;

/** Checks the parts of a patch that need the database. Field keys are the input names. */
export async function checkPatch(db: PrismaClient, patch: AppSettingsPatch): Promise<SettingsFieldErrors> {
  const errors: SettingsFieldErrors = {};
  if (patch.spam) {
    const current = readSpamSettings((await db.intelformSettings.findUnique({where: {id: 1}, select: {spamLimits: true}}))?.spamLimits);
    const next = {...current, ...patch.spam};
    if (next.spamIpPerDay < next.spamIpPerHour) errors.spamIpPerDay = DAY_BELOW_HOUR;
  }
  const themeId = patch.branding?.defaultThemeId;
  if (themeId) {
    if (themePreset(themeId)) return errors;
    if (!UUID_RE.test(themeId)) {
      errors.defaultThemeId = 'Pick a theme from the list';
    } else {
      const theme = await db.theme.findUnique({where: {id: themeId}, select: {id: true}});
      if (!theme) errors.defaultThemeId = 'That theme was deleted. Pick another one';
    }
  }
  return errors;
}

/**
 * Saves the groups the patch sends (only those keys), then clears the cached settings, after the
 * write succeeded and outside any transaction (cache.md). Returns the new view.
 */
export async function saveAppSettings(db: PrismaClient, patch: AppSettingsPatch, userId: number | null): Promise<AppSettingsResponse> {
  const data: Record<string, unknown> = settingsPatchData(patch);
  if (patch.spam) {
    // Merge into what is stored (only the limits sent change), validated value by value.
    const current = (await db.intelformSettings.findUnique({where: {id: 1}, select: {spamLimits: true}}))?.spamLimits;
    data.spamLimits = {...readSpamSettings(current), ...patch.spam};
  }
  const row = await db.intelformSettings.upsert({
    where: {id: 1},
    create: {id: 1, ...data, updatedById: userId},
    update: {...data, updatedById: userId},
    select: SETTINGS_ROW_SELECT,
  });
  // A new time zone: the Summary's day rollups of every form start again in it (marked forms only).
  if ('timezone' in data && typeof data.timezone === 'string') await markFormsForZone(db, data.timezone);
  await clearAppSettingsCache();
  return viewOf(row);
}

/** Clears every cached settings key. Call it after ANY write to `intelform_settings`. */
export async function clearAppSettingsCache(): Promise<void> {
  await cache.delPrefix(SETTINGS_CACHE_PREFIX);
}

// ---------------------------------------------------------------------------
// Everyone else: the cached reads
// ---------------------------------------------------------------------------

/** What the public pages, public forms and the dashboard shell read. Same for every visitor. */
export interface CachedAppSettings {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  timezone: string;
  dateFormat: DateFormat;
  accentColor: string | null;
  defaultMode: ColorMode;
  defaultThemeId: string | null;
  retentionDays: number | null;
  siteIndexing: boolean;
  siteDescription: string;
  siteOgImage: string | null;
  /** Shown on the public site (Settings → Public site); '' = hidden. */
  contactEmail: string;
  /** Sender name on notifications; null = the app name. */
  emailFromName: string | null;
  hasPrivacy: boolean;
  hasTerms: boolean;
}

type MainRow = Omit<CachedAppSettings, 'dateFormat' | 'defaultMode'> & {dateFormat: string; defaultMode: string};

/** Row → cached shape; values outside the allowed sets fall back to the defaults. */
export function cachedShape(row: MainRow): CachedAppSettings {
  return {
    appName: row.appName,
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    timezone: row.timezone,
    dateFormat: (DATE_FORMATS as readonly string[]).includes(row.dateFormat) ? (row.dateFormat as DateFormat) : 'DD/MM/YYYY',
    accentColor: row.accentColor,
    defaultMode: (COLOR_MODES as readonly string[]).includes(row.defaultMode) ? (row.defaultMode as ColorMode) : 'system',
    defaultThemeId: row.defaultThemeId,
    retentionDays: row.retentionDays === null ? null : Number(row.retentionDays),
    siteIndexing: Boolean(row.siteIndexing),
    siteDescription: row.siteDescription,
    siteOgImage: row.siteOgImage,
    contactEmail: row.contactEmail,
    emailFromName: row.emailFromName,
    hasPrivacy: Boolean(row.hasPrivacy),
    hasTerms: Boolean(row.hasTerms),
  };
}

function defaultCached(): CachedAppSettings {
  const row = defaultSettingsRow();
  const {privacyText: _p, termsText: _t, emailReplyTo: _r, ...rest} = row;
  return cachedShape({...rest, hasPrivacy: false, hasTerms: false});
}

/**
 * The app settings every page shares, from the Site Cache (7 days; cleared on save). One query on
 * a miss, without the legal texts (only whether they have text).
 */
export async function getAppSettings(db: PrismaClient): Promise<CachedAppSettings> {
  return cache.getOrSet(SETTINGS_MAIN_KEY, 7 * DAY, async () => {
    const rows = await db.$queryRaw<MainRow[]>`
      SELECT app_name AS "appName", logo_url AS "logoUrl", favicon_url AS "faviconUrl",
             timezone, date_format AS "dateFormat", accent_color AS "accentColor",
             default_mode AS "defaultMode", default_theme_id AS "defaultThemeId",
             retention_days AS "retentionDays",
             site_indexing AS "siteIndexing", site_description AS "siteDescription",
             site_og_image AS "siteOgImage", contact_email AS "contactEmail",
             email_from_name AS "emailFromName",
             (privacy_text <> '') AS "hasPrivacy", (terms_text <> '') AS "hasTerms"
      FROM intelform_settings WHERE id = 1`;
    return rows[0] ? cachedShape(rows[0]) : defaultCached();
  });
}

/** The Privacy policy or Terms text ('' = none), from the Site Cache (7 days; cleared on save). */
export async function getLegalText(db: PrismaClient, kind: 'privacy' | 'terms'): Promise<string> {
  return cache.getOrSet(legalCacheKey(kind), 7 * DAY, async () => {
    const row = await db.intelformSettings.findUnique({
      where: {id: 1},
      select: kind === 'privacy' ? {privacyText: true} : {termsText: true},
    });
    return (kind === 'privacy' ? row?.privacyText : row?.termsText) ?? '';
  });
}

/** Notification defaults for an email being sent now (database: the reply-to is an address). */
export async function getEmailDefaults(db: PrismaClient): Promise<{appName: string; fromName: string; replyTo: string | null; enabled: boolean}> {
  const row = await db.intelformSettings.findUnique({
    where: {id: 1},
    select: {appName: true, emailFromName: true, emailReplyTo: true},
  });
  const appName = row?.appName ?? defaultSettingsRow().appName;
  return {appName, fromName: row?.emailFromName || appName, replyTo: row?.emailReplyTo ?? null, enabled: emailEnabled()};
}
