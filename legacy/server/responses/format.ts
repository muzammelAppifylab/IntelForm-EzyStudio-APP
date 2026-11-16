import type { FormField } from '../../shared/form/definition'
import type { FieldType } from '../../shared/form/field-types'
import { answerToCsv } from '../../shared/form/csv'
import { countryName, formatDate, formatTime, isIsoDate, isTime } from '../../shared/form/types/registry'
import { storedSignatureUrl } from '../lib/signature-url'

/**
 * Answer → display text for the table, the drawer and the summary's latest answers.
 * Built on the registry's CSV cells, so labels and joins match the export.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface DisplayValue {
  text: string
  url?: string
}

export function displayAnswer(field: FormField, value: unknown): DisplayValue {
  if (value === undefined || value === null) return { text: '' }
  switch (field.type) {
    case 'section_break':
      return { text: '' }
    case 'name':
      return { text: answerToCsv(field, value).filter(Boolean).join(' ') || (typeof value === 'string' ? value : '') }
    case 'address':
      return { text: answerToCsv(field, value).filter(Boolean).join(', ') }
    case 'country':
      return { text: typeof value === 'string' && value ? countryName(value) : '' }
    case 'date':
      return { text: isIsoDate(value) ? formatDate(value, field.props.format) : '' }
    case 'time':
      return { text: isTime(value) ? formatTime(value, field.props.hourCycle) : '' }
    case 'consent':
      return { text: isRecord(value) && value.accepted === true ? 'Accepted' : '' }
    case 'signature': {
      // Only { url } pointing at a PNG this server stored is a signature. Anything else (say a
      // text answer kept when an Editor changed the field's type but not its id) is plain text.
      const url = storedSignatureUrl(value)
      if (url) return { text: 'Signed', url }
      return { text: typeof value === 'string' ? value : '' }
    }
    default:
      return { text: answerToCsv(field, value).join('; ') }
  }
}

/** Types whose text goes into responses.search_text. */
export const SEARCH_TEXT_TYPES = new Set<FieldType>(['name', 'email', 'phone', 'url', 'short_text', 'long_text', 'address'])

/**
 * `responses.search_text` for one submission: text answers (name, email, phone, URL, short and
 * long text, address) plus "Other" text, newline-separated. The submit route (Agent E) should
 * store this; rebuild existing rows if the set of types changes.
 */
export function buildSearchText(fields: readonly FormField[], answers: Record<string, unknown>): string {
  const parts: string[] = []
  for (const f of fields) {
    const v = answers[f.id]
    if (v === undefined || v === null) continue
    if (SEARCH_TEXT_TYPES.has(f.type)) {
      const t = f.type === 'name' || f.type === 'address' ? displayAnswer(f, v).text : typeof v === 'string' ? v : ''
      if (t) parts.push(t)
    } else if (isRecord(v) && typeof v.other === 'string' && v.other) {
      parts.push(v.other)
    } else if (Array.isArray(v)) {
      for (const x of v) if (isRecord(x) && typeof x.other === 'string' && x.other) parts.push(x.other)
    }
  }
  return parts.join('\n').slice(0, 20_000)
}
