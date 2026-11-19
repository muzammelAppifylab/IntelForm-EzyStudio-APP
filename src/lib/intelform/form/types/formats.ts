/**
 * Answer formats the logic needs without a field type's schema (no zod here): the respondent's
 * bundle loads the field types on demand (src/respondent/field-types.ts), the logic never waits.
 */

export const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = ISO_DATE_RE.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v)
}

/** E.164: "+", country code, up to 15 digits in all. libphonenumber /max runs on the server. */
export const E164_RE = /^\+[1-9]\d{6,14}$/

/** Spaces, brackets, dots and dashes are ignored, as in the answer: "+1 (650) 253-0000" passes. */
export function isE164(v: unknown): boolean {
  return typeof v === 'string' && E164_RE.test(v.replace(/[\s().-]/g, ''))
}

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]


/** Show a stored ISO date in the field's display format. */
export function formatDate(iso: string, format: DateFormat): string {
  const m = ISO_DATE_RE.exec(iso)
  if (!m) return iso
  const [, y, mo, d] = m
  switch (format) {
    case 'DD/MM/YYYY':
      return `${d}/${mo}/${y}`
    case 'MM/DD/YYYY':
      return `${mo}/${d}/${y}`
    case 'DD.MM.YYYY':
      return `${d}.${mo}.${y}`
    default:
      return iso
  }
}
