import { z } from 'zod'

/**
 * Spam protection limits (browser-safe: the builder, the Settings screen and the server share
 * them). Hard by default: a form takes few submits from one network address, and the site has a
 * ceiling across every form, so a bot can't flood a form, fill its response cap or turn its
 * confirmation email into a bulk mailer. Each form's owner can raise or lower them, within the
 * bounds below; new forms start from the site's defaults (Settings → Spam protection).
 *
 * A school, an office or a café shares ONE public address: everyone there counts as one visitor
 * for the per-address limits. A form shared in such a place needs its per-address limits raised.
 */

/** One limit's bounds and default. */
export interface LimitRule {
  min: number
  max: number
  default: number
}

/** Per form (stored flat in forms.settings, so SQL and the builder read them directly). */
export const FORM_LIMITS = {
  /** Submits from one address (IPv4 address, IPv6 /64) to this form, per hour. */
  spamIpPerHour: { min: 1, max: 1000, default: 5 },
  /** Submits from one address to this form, per day. */
  spamIpPerDay: { min: 1, max: 10_000, default: 20 },
  /** Submits to this form from every address together, per minute. */
  spamFormPerMinute: { min: 1, max: 100_000, default: 60 },
  /** Confirmation emails this form sends per hour. */
  confirmPerHour: { min: 1, max: 10_000, default: 100 },
} as const satisfies Record<string, LimitRule>

export type FormLimitKey = keyof typeof FORM_LIMITS

/** Per site (intelform_settings.spam_limits). */
export const SITE_LIMITS = {
  /** Submits to every form together, per minute. */
  sitePerMinute: { min: 10, max: 100_000, default: 300 },
  /** Confirmation emails from every form together, per day. */
  confirmPerDay: { min: 1, max: 100_000, default: 1000 },
} as const satisfies Record<string, LimitRule>

export type SiteLimitKey = keyof typeof SITE_LIMITS

/** Fixed limits (not settings). */
export const FIXED_LIMITS = {
  /** Confirmation emails to one address block, every form together, per hour. */
  confirmPerIpPerHour: 3,
  /** Confirmation emails to one recipient from one form, per day. */
  confirmPerRecipientPerFormPerDay: 1,
  /** Confirmation emails to one recipient from every form together, per day. */
  confirmPerRecipientPerDay: 5,
  /** Refused submits (over a per-address limit) in an hour before the address is blocked. */
  strikesBeforeBlock: 3,
} as const

/** Automatic block lengths: first, second, third and later block within 30 days. */
export const BLOCK_STEPS_SECONDS = [3600, 24 * 3600, 7 * 24 * 3600] as const

const whole = (r: LimitRule, what: string) =>
  z
    .number({ error: `Enter a whole number from ${r.min} to ${r.max.toLocaleString('en')}` })
    .int(`Enter a whole number from ${r.min} to ${r.max.toLocaleString('en')}`)
    .min(r.min, `Use at least ${r.min} ${what}`)
    .max(r.max, `Use ${r.max.toLocaleString('en')} ${what} or fewer`)

/** The form settings keys (merged into the form settings shape). */
export const formLimitShape = {
  spamIpPerHour: whole(FORM_LIMITS.spamIpPerHour, 'an hour'),
  spamIpPerDay: whole(FORM_LIMITS.spamIpPerDay, 'a day'),
  spamFormPerMinute: whole(FORM_LIMITS.spamFormPerMinute, 'a minute'),
  confirmPerHour: whole(FORM_LIMITS.confirmPerHour, 'an hour'),
}

export type FormLimits = { [K in FormLimitKey]: number }

export function defaultFormLimits(): FormLimits {
  return {
    spamIpPerHour: FORM_LIMITS.spamIpPerHour.default,
    spamIpPerDay: FORM_LIMITS.spamIpPerDay.default,
    spamFormPerMinute: FORM_LIMITS.spamFormPerMinute.default,
    confirmPerHour: FORM_LIMITS.confirmPerHour.default,
  }
}

/** A day limit below the hour limit is never reached: say so on the day field. */
export const DAY_BELOW_HOUR = 'Use a daily limit at least as high as the hourly one'

/** The site settings group (App settings → Spam protection). Every field optional in a PATCH. */
export const spamSettingsInput = z
  .object({
    sitePerMinute: whole(SITE_LIMITS.sitePerMinute, 'a minute'),
    confirmPerDay: whole(SITE_LIMITS.confirmPerDay, 'a day'),
    ...formLimitShape,
  })
  .partial()
  .strict()

export type SpamSettingsPatch = z.infer<typeof spamSettingsInput>

export type SpamSettings = FormLimits & { [K in SiteLimitKey]: number }

export function defaultSpamSettings(): SpamSettings {
  return { ...defaultFormLimits(), sitePerMinute: SITE_LIMITS.sitePerMinute.default, confirmPerDay: SITE_LIMITS.confirmPerDay.default }
}

const ALL_RULES: Record<keyof SpamSettings, LimitRule> = { ...FORM_LIMITS, ...SITE_LIMITS }

/**
 * The stored jsonb → full settings. A value missing or out of bounds (an old row, a hand edit)
 * takes its default, so the gate always has a number.
 */
export function readSpamSettings(raw: unknown): SpamSettings {
  const out = defaultSpamSettings()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const rec = raw as Record<string, unknown>
  for (const key of Object.keys(ALL_RULES) as (keyof SpamSettings)[]) {
    const v = rec[key]
    const r = ALL_RULES[key]
    if (typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max) out[key] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Allowed embedding sites (L2)
// ---------------------------------------------------------------------------

/**
 * One site allowed to embed a form: its origin (`https://example.com`, a port allowed), nothing
 * else. Normalised through URL, so what reaches the CSP header is always `scheme://host[:port]`:
 * no path, no spaces, no `;` or `'` that could change the policy.
 */
export function embedOrigin(value: string): string | null {
  const v = value.trim()
  if (!v || v.length > 200 || !/^https?:\/\//i.test(v) || !URL.canParse(v)) return null
  const url = new URL(v)
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')))) return null
  if (!/^[a-z0-9.-]+$/.test(url.hostname) || (!url.hostname.includes('.') && url.hostname !== 'localhost')) return null
  return url.origin
}

export const MAX_EMBED_ORIGINS = 20

export const embedOriginsSetting = z
  .array(
    z
      .string()
      .max(200, 'Use a shorter address')
      .refine((v) => embedOrigin(v) !== null, 'Enter a site address like https://example.com, without a page path'),
  )
  .max(MAX_EMBED_ORIGINS, `List ${MAX_EMBED_ORIGINS} sites or fewer`)
  .transform((list) => [...new Set(list.map((v) => embedOrigin(v)!))])

/**
 * The `frame-ancestors` value for a form: any site (no list), or exactly those origins and this
 * site. A list with nothing valid in it (never saved that way) fails closed: this site only.
 */
export function frameAncestors(origins: readonly string[] | undefined | null): string {
  if (!origins?.length) return '*'
  const clean = origins.map((o) => embedOrigin(o)).filter((o): o is string => !!o)
  return clean.length ? `'self' ${clean.join(' ')}` : "'self'"
}
