import { z } from 'zod'

/**
 * Per-form settings stored as jsonb in forms.settings (PRD "Form settings", plus the Share
 * tab's SEO and front page card). Keys are flat so SQL can read them directly, e.g. the close
 * scheduler reads `settings->>'closeAt'`.
 *
 * Defaults are chosen so a form is safe to publish without opening the Settings tab.
 * `formSettings.parse({})` returns every default, so old rows missing new keys still parse.
 *
 * `passwordHash` (argon2id) is server-only and never leaves the server. The webhook signing
 * secret is not in settings at all: it lives encrypted in forms.webhook_secret (server/lib/
 * webhooks.ts). Use `clientSettings()` for the dashboard and `publicSettings()` for respondents.
 */

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'Enter a full link starting with https://')

const timeZone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz })
      return true
    } catch {
      return false
    }
  }, 'Pick a time zone from the list')

const fieldRef = z.string().min(1).max(40)

export const SPAM_RATE_LIMIT_PER_MINUTE = 10
export const DEFAULT_CLOSED_MESSAGE = 'This form is no longer accepting responses.'

export const AFTER_SUBMIT = ['end_screen', 'redirect'] as const
export type AfterSubmit = (typeof AFTER_SUBMIT)[number]

export const STEP_SOUNDS = ['off', 'tick', 'chime', 'pop'] as const
export type StepSound = (typeof STEP_SOUNDS)[number]

export const webhookHeader = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Enter a header name')
    .max(100)
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Header names use letters, digits and dashes only'),
  value: z.string().max(1000),
})

export const webhookSettings = z.object({
  enabled: z.boolean(),
  /** One outbound URL per form; POST JSON on each completed response. */
  url: httpUrl.nullable(),
  headers: z.array(webhookHeader).max(20),
})
export type WebhookSettings = z.infer<typeof webhookSettings>

/** Every settings key without defaults. The PATCH input is a partial of this. */
const shape = {
  // Access and limits
  /** "Close form now". Kept in step with forms.status by the close / reopen routes. */
  closed: z.boolean(),
  /** Close on date: an ISO 8601 instant with offset, or null for off. */
  closeAt: z.iso.datetime({ offset: true }).nullable(),
  /** The creator's time zone, used to show and edit closeAt. */
  timezone: timeZone,
  /** Closes the form after N completed responses; null for off. */
  responseCap: z.number().int().min(1).max(10_000_000).nullable(),
  closedMessage: z.string().trim().max(1000),
  onePerBrowser: z.boolean(),
  onePerEmail: z.boolean(),
  /** The Email field checked for repeats while onePerEmail is on. */
  onePerEmailFieldId: fieldRef.nullable(),
  /** Server only: argon2id hash of the form password, or null for no password. */
  passwordHash: z.string().max(500).nullable(),

  // After submit
  afterSubmit: z.enum(AFTER_SUBMIT),
  redirectUrl: httpUrl.nullable(),
  /** Append answers to the redirect URL as query parameters. */
  redirectAppendAnswers: z.boolean(),

  // Sounds (one at a time and section by section layouts)
  /** Short sound when a respondent moves to the next question or section, and on submit. */
  stepSound: z.enum(STEP_SOUNDS),

  // Notifications (need the email provider)
  notifyOnResponse: z.boolean(),
  /** Team member user ids. Empty means the Owner. */
  notifyRecipients: z.array(z.uuid()).max(50),
  confirmationEmail: z.boolean(),
  confirmationEmailFieldId: fieldRef.nullable(),
  confirmationSubject: z.string().trim().max(200),
  confirmationBody: z.string().max(10_000),

  // Webhook (read by server/lib/webhooks.ts readWebhookConfig)
  webhook: webhookSettings,

  // Spam (honeypot and the rate limit are always on)
  turnstile: z.boolean(),

  // SEO and social preview
  seoTitle: z.string().trim().max(120),
  seoDescription: z.string().trim().max(300),
  ogImage: httpUrl.nullable(),
  /** Hide from search engines (default on). */
  noindex: z.boolean(),

  // Front page card
  showOnFrontPage: z.boolean(),
  frontPageDescription: z.string().trim().max(300),
}

export type FormSettings = { [K in keyof typeof shape]: z.infer<(typeof shape)[K]> }

export function defaultFormSettings(): FormSettings {
  return {
    closed: false,
    closeAt: null,
    timezone: 'UTC',
    responseCap: null,
    closedMessage: DEFAULT_CLOSED_MESSAGE,
    onePerBrowser: false,
    onePerEmail: false,
    onePerEmailFieldId: null,
    passwordHash: null,
    afterSubmit: 'end_screen',
    redirectUrl: null,
    redirectAppendAnswers: false,
    stepSound: 'off',
    notifyOnResponse: false,
    notifyRecipients: [],
    confirmationEmail: false,
    confirmationEmailFieldId: null,
    confirmationSubject: 'Thanks for your response',
    confirmationBody: 'We received your response. Thanks for taking the time.',
    webhook: { enabled: false, url: null, headers: [] },
    turnstile: true,
    seoTitle: '',
    seoDescription: '',
    ogImage: null,
    noindex: true,
    showOnFrontPage: false,
    frontPageDescription: '',
  }
}

const strictSettings = z.object(shape).superRefine((s, ctx) => {
  if (s.webhook.enabled && !s.webhook.url) {
    ctx.addIssue({ code: 'custom', path: ['webhook', 'url'], message: 'Enter the webhook URL, or turn the webhook off' })
  }
  if (s.afterSubmit === 'redirect' && !s.redirectUrl) {
    ctx.addIssue({ code: 'custom', path: ['redirectUrl'], message: 'Enter the link to send people to after they submit' })
  }
})

/**
 * Full settings. Missing keys take their defaults (so `{}` and older rows parse); unknown keys
 * are dropped.
 */
export const formSettings = z.preprocess(
  (v) => ({ ...defaultFormSettings(), ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) }),
  strictSettings,
) as unknown as z.ZodType<FormSettings>

const { passwordHash: _ph, webhook: _wh, ...editable } = shape

/**
 * What the dashboard may send in PATCH /api/forms/:id `{ settings }`. Only the keys sent are
 * changed. `password` sets (plain text, hashed by the server) or clears (null) the password.
 * The server-only keys can't be written directly.
 */
export const formSettingsPatch = z
  .object({
    ...editable,
    /** Only the keys sent change. */
    webhook: webhookSettings.partial(),
    password: z.string().min(8, 'Use at least 8 characters').max(200).nullable(),
  })
  .partial()
  .strict()
export type FormSettingsPatch = z.infer<typeof formSettingsPatch>

/**
 * Settings as the dashboard sees them: the password hash replaced by a flag. For people who
 * can't edit the form (viewers), the webhook URL and header values are blanked and
 * `webhookRedacted` is true: Slack or Zapier URLs and `Authorization` headers are secrets.
 */
export type ClientFormSettings = Omit<FormSettings, 'passwordHash'> & { hasPassword: boolean; webhookRedacted: boolean }

export function clientSettings(settings: FormSettings, opts: { canEdit: boolean }): ClientFormSettings {
  const { passwordHash, ...rest } = settings
  if (opts.canEdit) return { ...rest, hasPassword: !!passwordHash, webhookRedacted: false }
  const { webhook } = settings
  return {
    ...rest,
    hasPassword: !!passwordHash,
    webhook: { enabled: webhook.enabled && !!webhook.url, url: null, headers: webhook.headers.map((h) => ({ key: h.key, value: '' })) },
    webhookRedacted: true,
  }
}

/** What a respondent's browser needs to render and submit a form. No secrets, no team data. */
export interface PublicFormSettings {
  closedMessage: string
  passwordRequired: boolean
  onePerBrowser: boolean
  afterSubmit: AfterSubmit
  redirectUrl: string | null
  redirectAppendAnswers: boolean
  turnstile: boolean
  stepSound: StepSound
  seoTitle: string
  seoDescription: string
  ogImage: string | null
  noindex: boolean
}

export function publicSettings(settings: FormSettings): PublicFormSettings {
  return {
    closedMessage: settings.closedMessage,
    passwordRequired: !!settings.passwordHash,
    onePerBrowser: settings.onePerBrowser,
    afterSubmit: settings.afterSubmit,
    redirectUrl: settings.afterSubmit === 'redirect' ? settings.redirectUrl : null,
    redirectAppendAnswers: settings.redirectAppendAnswers,
    turnstile: settings.turnstile,
    stepSound: settings.stepSound,
    seoTitle: settings.seoTitle,
    seoDescription: settings.seoDescription,
    ogImage: settings.ogImage,
    noindex: settings.noindex,
  }
}

/**
 * Settings to copy into a duplicate or a template (the webhook secret is a column, so it is
 * never copied). Templates also drop the password, webhook target and recipients, since the
 * whole team can use them.
 */
export function copyableSettings(settings: FormSettings, forTemplate = false): FormSettings {
  const copy: FormSettings = { ...settings, closed: false, closeAt: null }
  if (!forTemplate) return copy
  return {
    ...copy,
    passwordHash: null,
    webhook: { enabled: false, url: null, headers: [] },
    notifyRecipients: [],
    showOnFrontPage: false,
  }
}
