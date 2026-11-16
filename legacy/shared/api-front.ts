import type { AppInfo } from './api'
import type { ColorMode, DateFormat } from './settings-app'

/**
 * The public site: home (/), About, Forms, Privacy and Terms. The pages and their copy live in
 * code (src/pages/public); edit them there. What changes without a deploy comes from Settings:
 * the app name and logo (General), search and sharing, and the Privacy and Terms texts
 * (Public site).
 *
 * Which forms the site lists lives on each form (`forms.settings.showOnFrontPage` and
 * `frontPageDescription`, the Share tab's Homepage fields).
 */

/** A form card on the public site. */
export interface PublicFormCard {
  title: string
  slug: string
  description: string
  /** "Takes about X min", from the published start screen. */
  minutes: number | null
}

/** GET /api/public/home: what every public site page needs. */
export interface PublicHome {
  appName: string
  logoUrl: string | null
  /** Listed Live forms, by title. */
  forms: PublicFormCard[]
  /** Meta description for the home page. */
  description: string
  ogImage: string | null
  /** Settings → Public site; empty = hidden. */
  contactEmail: string
  /** Let search engines index the site's pages. */
  indexing: boolean
  hasPrivacy: boolean
  hasTerms: boolean
}

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
