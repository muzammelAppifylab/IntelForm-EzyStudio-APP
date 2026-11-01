import { formatDistanceToNowStrict } from 'date-fns'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import type { ContactRow } from '@shared/api-contacts'
import { countryName } from '@shared/form/types/countries'
import { initials } from '@/lib/utils'

/** Display helpers for the Contacts page. */

const numberFmt = new Intl.NumberFormat()
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const dayShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export const formatNumber = (n: number) => numberFmt.format(n)
export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`

/** "3 days ago"; the full date goes in a title attribute. */
export const relative = (iso: string) => `${formatDistanceToNowStrict(new Date(iso))} ago`
export const fullDate = (iso: string) => dateTime.format(new Date(iso))
export const formatDate = (iso: string) => dateOnly.format(new Date(iso))

/** "Oct 19" for a YYYY-MM-DD local day (no time-zone shift). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayShort.format(new Date(y, m - 1, d))
}

/** Local date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const countryLabel = (code: string | null) => (code ? countryName(code) : '–')

/** +14155550123 → "+1 415 555 0123". */
export function formatPhone(phone: string): string {
  try {
    return parsePhoneNumberFromString(phone)?.formatInternational() ?? phone
  } catch {
    return phone
  }
}

/** The name, else the email, else the phone. */
export function contactTitle(c: Pick<ContactRow, 'name' | 'email' | 'phone'>): string {
  return c.name || c.email || (c.phone ? formatPhone(c.phone) : 'Unknown contact')
}

/** The line under the title: the email when the title is the name, else the phone. */
export function contactSubtitle(c: Pick<ContactRow, 'name' | 'email' | 'phone'>): string | null {
  if (c.name) return c.email ?? (c.phone ? formatPhone(c.phone) : null)
  if (c.email) return c.phone ? formatPhone(c.phone) : null
  return null
}

export function contactInitials(c: Pick<ContactRow, 'name' | 'email' | 'phone'>): string {
  if (c.name) return initials(c.name) || '?'
  if (c.email) return c.email[0]!.toUpperCase()
  return '#'
}

/** 95_000 → "1m 35s"; 4_000 → "4s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.round(h / 24)}d`
}

export const deviceLabel = (d: string | null) => (d ? d.charAt(0).toUpperCase() + d.slice(1) : null)
