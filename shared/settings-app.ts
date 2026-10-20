import { z } from 'zod'

/**
 * App settings (PRD "App settings"), Owner only. Shared by the Settings UI and
 * /api/settings. Secret fields are write-only: the API returns `{ set: boolean }` for them,
 * accepts a string to replace the value, `null` to clear it, and leaves it alone when omitted.
 */

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const COLOR_MODES = ['light', 'dark', 'system'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const EMAIL_DRIVERS = ['none', 'console', 'smtp', 'resend', 'postmark'] as const
export type EmailDriverName = (typeof EMAIL_DRIVERS)[number]

export const EMAIL_DRIVER_LABEL: Record<EmailDriverName, string> = {
  none: 'Off',
  console: 'Server log (development)',
  smtp: 'SMTP',
  resend: 'Resend',
  postmark: 'Postmark',
}

/** What an upload is for. SVG is accepted only for logo and favicon. */
export const UPLOAD_PURPOSES = ['logo', 'favicon', 'image', 'og', 'avatar'] as const
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number]
export const SVG_PURPOSES: readonly UploadPurpose[] = ['logo', 'favicon']
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** An image URL: http(s), or a file this app serves itself. */
export const imageUrl = z
  .string()
  .trim()
  .max(2048, 'Use a shorter link')
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/api/uploads/files/') || v.startsWith('/uploads/'), 'Upload an image or use an https link')

/** True when the text has no line breaks or other control characters (names end up in email headers). */
export function isSingleLine(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return false
  }
  return true
}

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const secretInput = z.string().trim().min(1, 'Enter a value').max(500, 'That value is too long').nullable().optional()

// ---------------------------------------------------------------------------
// Groups (PATCH input: every field optional)
// ---------------------------------------------------------------------------

export const generalSettingsInput = z.object({
  appName: z.string().trim().min(1, 'Enter an app name').max(60, 'Use 60 characters or fewer').refine(isSingleLine, 'Use one line of text').optional(),
  logoUrl: imageUrl.nullable().optional(),
  faviconUrl: imageUrl.nullable().optional(),
  timezone: z.string().trim().refine(isTimeZone, 'Pick a timezone from the list').optional(),
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

export const spamSettingsInput = z.object({
  turnstileSiteKey: z.string().trim().max(200, 'That key is too long').nullable().optional(),
  turnstileSecret: secretInput,
})

const emailAddress = z.string().trim().toLowerCase().pipe(z.email('Enter an email address like name@example.com'))

export const emailSettingsInput = z.object({
  driver: z.enum(EMAIL_DRIVERS).optional(),
  fromName: z.string().trim().max(100, 'Use 100 characters or fewer').refine(isSingleLine, 'Use one line of text').nullable().optional(),
  fromAddress: emailAddress.nullable().optional(),
  replyTo: emailAddress.nullable().optional(),
  smtpHost: z.string().trim().max(255).nullable().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535, 'Use a port between 1 and 65535').nullable().optional(),
  /** true = TLS from the start (port 465); false = STARTTLS when offered (587). */
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(255).nullable().optional(),
  smtpPass: secretInput,
  resendApiKey: secretInput,
  postmarkToken: secretInput,
})

export const dataSettingsInput = z.object({
  /** Delete responses older than this many days. null = keep forever (default). */
  retentionDays: z.coerce.number().int().min(1, 'Use at least 1 day').max(3650, 'Use 3650 days or fewer').nullable().optional(),
})

export const appSettingsPatch = z.object({
  general: generalSettingsInput.optional(),
  branding: brandingSettingsInput.optional(),
  spam: spamSettingsInput.optional(),
  email: emailSettingsInput.optional(),
  data: dataSettingsInput.optional(),
})
export type AppSettingsPatch = z.infer<typeof appSettingsPatch>

export const emailTestInput = z.object({ to: emailAddress.optional() })

// ---------------------------------------------------------------------------
// Response (GET /api/settings)
// ---------------------------------------------------------------------------

/** A write-only secret as the browser sees it. */
export interface SecretState {
  set: boolean
}

export interface AppSettingsView {
  general: { appName: string; logoUrl: string | null; faviconUrl: string | null; timezone: string; dateFormat: DateFormat }
  branding: { accentColor: string | null; defaultMode: ColorMode; defaultThemeId: string | null }
  spam: { turnstileSiteKey: string | null; turnstileSecret: SecretState }
  email: {
    driver: EmailDriverName
    fromName: string | null
    fromAddress: string | null
    replyTo: string | null
    smtpHost: string | null
    smtpPort: number | null
    smtpSecure: boolean
    smtpUser: string | null
    smtpPass: SecretState
    resendApiKey: SecretState
    postmarkToken: SecretState
    /** Set when the EMAIL_DRIVER env variable overrides these settings (development). */
    envOverride: 'none' | 'console' | null
    /** Whether emails actually go out right now (forgot password, invites, notifications). */
    enabled: boolean
  }
  storage: {
    driver: 'bunny' | 'local'
    /** Bunny zone name when configured. */
    zone: string | null
    /** Public base URL that uploaded files are served from. */
    publicBaseUrl: string
  }
  data: { retentionDays: number | null }
}

/** Result of a "Test" button (Turnstile keys, email, storage). */
export interface SettingsTestResult {
  ok: boolean
  message: string
}
