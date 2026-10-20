import { z } from 'zod'
import type { AppInfo } from './api'
import { safeUrl } from './form/safe-url'
import { THEME_PRESETS } from './form/theme'
import { imageUrl, type ColorMode, type DateFormat } from './settings-app'

/**
 * Public front page (PRD "Public front pages and login"): the creator's forms hub at /, plus
 * the Privacy and Terms texts. Stored in app_settings under key `front_page`.
 *
 * Every text is plain text, rendered as text (never HTML); line breaks become paragraphs.
 *
 * Which forms are featured lives on each form (`forms.settings.showOnFrontPage` and
 * `frontPageDescription`, the Share tab's fields), so the Share tab and this editor always
 * agree. This key only stores their order (`featuredOrder`).
 */

const text = (max: number, tooLong = `Use ${max} characters or fewer`) => z.string().trim().max(max, tooLong)

export const PRESET_IDS = THEME_PRESETS.map((p) => p.id) as [string, ...string[]]

export const frontHero = z
  .object({
    headline: text(120),
    text: text(600),
    /** Logo or image beside the headline (uploaded, or an https link). */
    imageUrl: imageUrl.nullable(),
    imageAlt: text(200),
    buttonLabel: text(40),
    buttonUrl: safeUrl.nullable(),
  })
  .superRefine((h, ctx) => {
    if (h.buttonLabel && !h.buttonUrl) ctx.addIssue({ code: 'custom', path: ['buttonUrl'], message: 'Add the link the button opens, or clear the label' })
    if (h.buttonUrl && !h.buttonLabel) ctx.addIssue({ code: 'custom', path: ['buttonLabel'], message: 'Add a button label, or clear the link' })
  })

export const frontAbout = z.object({
  enabled: z.boolean(),
  title: text(120),
  text: text(4000),
})

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter an email address like name@example.com')

export const frontContact = z.object({
  enabled: z.boolean(),
  email: optionalEmail,
  phone: text(40),
  address: text(500),
})

export const frontSeo = z.object({
  title: text(120),
  description: text(300),
  ogImage: imageUrl.nullable(),
  /** Let search engines index the front page. Off by default. */
  indexing: z.boolean(),
})

/** Everything on the page except the featured forms. */
export const frontPageContent = z.object({
  enabled: z.boolean(),
  hero: frontHero,
  about: frontAbout,
  contact: frontContact,
  seo: frontSeo,
  /** One of the built-in form theme presets. */
  themeId: z.enum(PRESET_IDS, 'Pick one of the themes'),
  privacy: text(50_000, 'Keep it under 50,000 characters'),
  terms: text(50_000, 'Keep it under 50,000 characters'),
})
export type FrontPageContent = z.infer<typeof frontPageContent>

export const featuredFormInput = z.object({
  formId: z.uuid('Pick a form from the list'),
  /** The card's short description (also the form's Share tab "front page description"). */
  description: text(300),
})
export type FeaturedFormInput = z.infer<typeof featuredFormInput>

/**
 * PATCH /api/front-page. Every key is optional; `featured` (when sent) is the complete ordered
 * list: forms left out stop being featured.
 */
export const frontPagePatch = frontPageContent.partial().extend({
  featured: z
    .array(featuredFormInput)
    .max(50, 'Feature 50 forms or fewer')
    .refine((list) => new Set(list.map((f) => f.formId)).size === list.length, 'Each form can be featured once')
    .optional(),
})
export type FrontPagePatch = z.infer<typeof frontPagePatch>

export function defaultFrontPage(): FrontPageContent {
  return {
    enabled: false,
    hero: { headline: '', text: '', imageUrl: null, imageAlt: '', buttonLabel: '', buttonUrl: null },
    about: { enabled: false, title: 'About us', text: '' },
    contact: { enabled: false, email: '', phone: '', address: '' },
    seo: { title: '', description: '', ogImage: null, indexing: false },
    themeId: 'intelform',
    privacy: '',
    terms: '',
  }
}

/**
 * Reads a stored value leniently: missing or invalid parts fall back to the defaults, so an
 * older or hand-edited row never breaks the page.
 */
export function readFrontPage(stored: unknown): FrontPageContent {
  const d = defaultFrontPage()
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const part = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const merged = value && typeof value === 'object' && fallback && typeof fallback === 'object' ? { ...fallback, ...value } : value
    const r = schema.safeParse(merged)
    return r.success ? r.data : fallback
  }
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    hero: part(frontHero, s.hero, d.hero),
    about: part(frontAbout, s.about, d.about),
    contact: part(frontContact, s.contact, d.contact),
    seo: part(frontSeo, s.seo, d.seo),
    themeId: part(frontPageContent.shape.themeId, s.themeId, d.themeId),
    privacy: part(frontPageContent.shape.privacy, s.privacy, d.privacy),
    terms: part(frontPageContent.shape.terms, s.terms, d.terms),
  }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A featured form as the editor sees it, including ones no longer public. */
export interface FeaturedFormView {
  formId: string
  title: string
  slug: string
  status: 'draft' | 'live' | 'closed'
  description: string
  minutes: number | null
  /** Live and published: shown on the public page. */
  isPublic: boolean
}

/** GET / PATCH /api/front-page */
export interface FrontPageView {
  content: FrontPageContent
  featured: FeaturedFormView[]
}

/** GET /api/front-page/forms: Live forms the editor can feature. */
export interface PickableForm {
  id: string
  title: string
  slug: string
  description: string
  minutes: number | null
  featured: boolean
}
export interface PickableFormsResponse {
  forms: PickableForm[]
}

/** A form card on the public page. */
export interface PublicFormCard {
  title: string
  slug: string
  description: string
  /** "Takes about X min", from the published start screen. */
  minutes: number | null
}

export interface PublicHomeOn {
  enabled: true
  appName: string
  logoUrl: string | null
  hero: FrontPageContent['hero']
  about: FrontPageContent['about'] | null
  contact: FrontPageContent['contact'] | null
  seo: FrontPageContent['seo']
  themeId: string
  forms: PublicFormCard[]
  hasPrivacy: boolean
  hasTerms: boolean
}

/** GET /api/public/home */
export type PublicHome = { enabled: false } | PublicHomeOn

export const LEGAL_KINDS = ['privacy', 'terms'] as const
export type LegalKind = (typeof LEGAL_KINDS)[number]
export const LEGAL_TITLE: Record<LegalKind, string> = { privacy: 'Privacy policy', terms: 'Terms' }

/** GET /api/public/legal/:kind */
export interface PublicLegal {
  kind: LegalKind
  title: string
  appName: string
  text: string
}

/**
 * GET /api/public/app: AppInfo plus the branding the public pages and dashboard shell use.
 * (Proposed for AppInfo in shared/api.ts; kept here until the platform owner adds it.)
 */
export interface PublicAppInfo extends AppInfo {
  faviconUrl: string | null
  /** Dashboard accent colour (#RRGGBB) or null for the design system default. */
  accentColor: string | null
  defaultMode: ColorMode
  /** App settings' default date format, used for new Date questions. */
  dateFormat: DateFormat
}

/** "Takes about X min" */
export function minutesLabel(minutes: number | null | undefined): string | null {
  if (!minutes) return null
  return `Takes about ${minutes} min`
}

/** Splits plain text into paragraphs on blank lines; single line breaks stay inside one. */
export function paragraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trimEnd()))
    .filter((lines) => lines.some((l) => l.trim()))
}
