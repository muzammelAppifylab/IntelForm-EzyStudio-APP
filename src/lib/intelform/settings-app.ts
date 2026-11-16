import { z } from 'zod'

/**
 * IntelForm's app settings (Settings screen, codename `site:intelform:settings`), stored in the
 * one `intelform_settings` row. Shared by the Settings UI and its Site API route.
 *
 * Only non-secret values live here. What IntelForm used to keep as encrypted settings is now the
 * platform's: emails go through the platform's relay (no SMTP / Resend / Postmark settings), files
 * through the platform's storage (no Bunny settings), and the Turnstile secret key is an owner
 * secret read on the server with `config.ownerSecret('TURNSTILE_SECRET_KEY')`.
 */

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const COLOR_MODES = ['light', 'dark', 'system'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

/** What an upload is for. SVG is accepted only for logo and favicon. */
export const UPLOAD_PURPOSES = ['logo', 'favicon', 'image', 'og'] as const
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number]
export const SVG_PURPOSES: readonly UploadPurpose[] = ['logo', 'favicon']
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Image types an upload of each purpose may have (checked in the browser and again in the route). */
export const UPLOAD_TYPES: Record<UploadPurpose, readonly string[]> = {
  logo: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
  favicon: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'],
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  og: ['image/png', 'image/jpeg', 'image/webp'],
}

/** Where a public file stored by the platform is served on this site (`publicFileUrl` in src/platform/files.ts). */
export const PLATFORM_FILE_PREFIX = '/__platform/files/'
const PLATFORM_FILE = /^\/__platform\/files\/[A-Za-z0-9_-]{1,100}\/[^/?#\s]{1,300}$/

/**
 * True for a public file this site stored (`/__platform/files/<id>/<name>`). Images elsewhere
 * are refused: a logo or social image on a server someone else controls would log every
 * viewer's IP address.
 */
export function isUploadedFileUrl(v: string): boolean {
  return v.length <= 2048 && PLATFORM_FILE.test(v) && !v.includes('..')
}

/**
 * A team-supplied image shown in the dashboard or on the public site (logo, favicon, social
 * preview image): only files uploaded to this site.
 */
export const imageUrl = z
  .string()
  .trim()
  .max(2048, 'Use a shorter link')
  .refine((v) => isUploadedFileUrl(v), 'Upload the image here instead of linking to another site')

/** True when the text has no line breaks or other control characters (names end up in email headers). */
export function isSingleLine(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return false
  }
  return true
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const emailAddress = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter an email address like name@example.com'))

// ---------------------------------------------------------------------------
// Groups (PATCH input: every field optional)
// ---------------------------------------------------------------------------

export const generalSettingsInput = z.object({
  appName: z.string().trim().min(1, 'Enter an app name').max(60, 'Use 60 characters or fewer').refine(isSingleLine, 'Use one line of text').optional(),
  logoUrl: imageUrl.nullable().optional(),
  faviconUrl: imageUrl.nullable().optional(),
  timezone: z.string().trim().max(64).refine(isTimeZone, 'Pick a timezone from the list').optional(),
  dateFormat: z.enum(DATE_FORMATS).optional(),
})

export const brandingSettingsInput = z.object({
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4F46E5')
    .nullable()
    .optional(),
  defaultMode: z.enum(COLOR_MODES).optional(),
  /** A built-in theme preset id or a saved theme's uuid; null = the built-in default. */
  defaultThemeId: z.string().trim().min(1).max(100).nullable().optional(),
})

/** Spam protection: the Turnstile SITE key (public). The secret key is an owner secret. */
export const spamSettingsInput = z.object({
  turnstileSiteKey: z.string().trim().max(200, 'That key is too long').nullable().optional(),
})

export const dataSettingsInput = z.object({
  /** Delete responses older than this many days. null = keep forever (default). */
  retentionDays: z.coerce.number().int().min(1, 'Use at least 1 day').max(3650, 'Use 3650 days or fewer').nullable().optional(),
})

/** Notification defaults for response notifications and confirmation emails (sent by the platform). */
export const notificationSettingsInput = z.object({
  /** Sender name; null = the app name. */
  fromName: z.string().trim().max(100, 'Use 100 characters or fewer').refine(isSingleLine, 'Use one line of text').nullable().optional(),
  replyTo: emailAddress.nullable().optional(),
})

/** Search and sharing for the public site (its pages and copy are code). */
export const siteSettingsInput = z.object({
  /** Let search engines index the public site. Off by default. Forms keep their own setting. */
  indexing: z.boolean().optional(),
  description: z.string().trim().max(300, 'Use 300 characters or fewer').optional(),
  ogImage: imageUrl.nullable().optional(),
  /** Shown on the public site so visitors can reach you. Empty = hidden. */
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter an email address like name@example.com')
    .optional(),
})

const legalText = z.string().trim().max(50_000, 'Keep it under 50,000 characters')

/** Privacy policy and Terms, plain text. Empty = the page and its footer link are hidden. */
export const legalSettingsInput = z.object({
  privacy: legalText.optional(),
  terms: legalText.optional(),
})

export const appSettingsPatch = z.object({
  general: generalSettingsInput.optional(),
  branding: brandingSettingsInput.optional(),
  spam: spamSettingsInput.optional(),
  notifications: notificationSettingsInput.optional(),
  data: dataSettingsInput.optional(),
  site: siteSettingsInput.optional(),
  legal: legalSettingsInput.optional(),
})
export type AppSettingsPatch = z.infer<typeof appSettingsPatch>

// ---------------------------------------------------------------------------
// Response (GET settings)
// ---------------------------------------------------------------------------

export interface AppSettingsView {
  general: { appName: string; logoUrl: string | null; faviconUrl: string | null; timezone: string; dateFormat: DateFormat }
  branding: { accentColor: string | null; defaultMode: ColorMode; defaultThemeId: string | null }
  spam: {
    turnstileSiteKey: string | null
    /** Whether the owner set the Turnstile secret key (an owner secret); never the value. */
    turnstileSecretSet: boolean
  }
  notifications: {
    fromName: string | null
    replyTo: string | null
    /** Whether emails go out right now (the platform's relay is available). */
    enabled: boolean
  }
  data: { retentionDays: number | null }
  site: { indexing: boolean; description: string; ogImage: string | null; contactEmail: string }
  legal: { privacy: string; terms: string }
}

/** The settings before anyone changed them (the migration's column defaults). */
export function defaultAppSettings(): Omit<AppSettingsView, 'spam' | 'notifications'> & {
  spam: { turnstileSiteKey: null }
  notifications: { fromName: null; replyTo: null }
} {
  return {
    general: { appName: 'IntelForm', logoUrl: null, faviconUrl: null, timezone: 'UTC', dateFormat: 'DD/MM/YYYY' },
    branding: { accentColor: null, defaultMode: 'system', defaultThemeId: null },
    spam: { turnstileSiteKey: null },
    notifications: { fromName: null, replyTo: null },
    data: { retentionDays: null },
    site: { indexing: false, description: '', ogImage: null, contactEmail: '' },
    legal: { privacy: '', terms: '' },
  }
}

/** The `intelform_settings` row's columns (Prisma `IntelformSettings`) as the grouped view. */
export interface AppSettingsRow {
  appName: string
  logoUrl: string | null
  faviconUrl: string | null
  timezone: string
  dateFormat: string
  accentColor: string | null
  defaultMode: string
  defaultThemeId: string | null
  turnstileSiteKey: string | null
  retentionDays: number | null
  siteIndexing: boolean
  siteDescription: string
  siteOgImage: string | null
  contactEmail: string
  privacyText: string
  termsText: string
  emailFromName: string | null
  emailReplyTo: string | null
}

/** Row → view. Values outside the allowed sets fall back to the defaults. */
export function settingsView(row: AppSettingsRow, extra: { turnstileSecretSet: boolean; emailEnabled: boolean }): AppSettingsView {
  return {
    general: {
      appName: row.appName,
      logoUrl: row.logoUrl,
      faviconUrl: row.faviconUrl,
      timezone: row.timezone,
      dateFormat: (DATE_FORMATS as readonly string[]).includes(row.dateFormat) ? (row.dateFormat as DateFormat) : 'DD/MM/YYYY',
    },
    branding: {
      accentColor: row.accentColor,
      defaultMode: (COLOR_MODES as readonly string[]).includes(row.defaultMode) ? (row.defaultMode as ColorMode) : 'system',
      defaultThemeId: row.defaultThemeId,
    },
    spam: { turnstileSiteKey: row.turnstileSiteKey, turnstileSecretSet: extra.turnstileSecretSet },
    notifications: { fromName: row.emailFromName, replyTo: row.emailReplyTo, enabled: extra.emailEnabled },
    data: { retentionDays: row.retentionDays },
    site: { indexing: row.siteIndexing, description: row.siteDescription, ogImage: row.siteOgImage, contactEmail: row.contactEmail },
    legal: { privacy: row.privacyText, terms: row.termsText },
  }
}

/** A PATCH → the `intelform_settings` columns to update (only the keys sent). */
export function settingsPatchData(patch: AppSettingsPatch): Partial<AppSettingsRow> {
  const out: Partial<AppSettingsRow> = {}
  const set = <K extends keyof AppSettingsRow>(k: K, v: AppSettingsRow[K] | undefined) => {
    if (v !== undefined) out[k] = v
  }
  const { general: g, branding: b, spam: s, notifications: n, data: d, site, legal } = patch
  set('appName', g?.appName)
  set('logoUrl', g?.logoUrl)
  set('faviconUrl', g?.faviconUrl)
  set('timezone', g?.timezone)
  set('dateFormat', g?.dateFormat)
  set('accentColor', b?.accentColor)
  set('defaultMode', b?.defaultMode)
  set('defaultThemeId', b?.defaultThemeId)
  set('turnstileSiteKey', s?.turnstileSiteKey === '' ? null : s?.turnstileSiteKey)
  set('emailFromName', n?.fromName === '' ? null : n?.fromName)
  set('emailReplyTo', n?.replyTo)
  set('retentionDays', d?.retentionDays)
  set('siteIndexing', site?.indexing)
  set('siteDescription', site?.description)
  set('siteOgImage', site?.ogImage)
  set('contactEmail', site?.contactEmail)
  set('privacyText', legal?.privacy)
  set('termsText', legal?.terms)
  return out
}

/** Result of a "Test" button (e.g. sending a test email). */
export interface SettingsTestResult {
  ok: boolean
  message: string
}
