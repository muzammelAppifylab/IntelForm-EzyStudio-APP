import type { FormDefinition, FormField } from '../../shared/form/definition'
import { FIELD_TYPE_META } from '../../shared/form/field-types'
import { computeVisibility, type Answers } from '../../shared/form/logic'

/**
 * Builds a valid answer set for any form definition, straight from the field-type contract
 * (docs/contracts/form-core.md "Answer encodings"). Fields are answered in order and only while
 * visible, so logic rules decide which follow-ups get an answer (a hidden answer is rejected).
 *
 * Used by server/test/templates-submit.int.test.ts and the browser specs (expected values).
 */

/** A 1×1 transparent PNG, the shape the signature pad sends. */
export const SIGNATURE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export interface AnswerOptions {
  /** Answer optional fields too (default true). */
  optional?: boolean
  /** Makes emails unique per submission (one-response-per-email templates). */
  seed?: string | number
  /** Per-type values, e.g. `{ nps: 3 }` to take the low-score branch. */
  byType?: Partial<Record<FormField['type'], unknown>>
  /** Per-field values; wins over everything else. */
  byId?: Record<string, unknown>
  /** "Today" for date limits (YYYY-MM-DD); defaults to the local date. */
  today?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function text(min: number | null, max: number | null, base: string): string {
  let s = base
  while (min && s.length < min) s += ' and more detail'
  if (max && s.length > max) s = s.slice(0, max).trim()
  return s
}

/** One valid, non-empty answer for a field. */
export function validAnswer(field: FormField, opts: AnswerOptions = {}): unknown {
  const seed = opts.seed ?? 1
  switch (field.type) {
    case 'email':
      return field.props.blockFreeDomains ? `tester.${seed}@acme-industries.com` : `tester.${seed}@example.com`
    case 'name':
      return field.props.split ? { first: 'Ada', last: 'Lovelace' } : 'Ada Lovelace'
    case 'phone':
      return '+442079460958'
    case 'address': {
      const all = { street: '1 Main Street', line2: 'Flat 2', city: 'London', state: 'Greater London', postal: 'SW1A 1AA', country: 'GB' }
      return Object.fromEntries(Object.entries(all).filter(([k]) => field.props.lines[k as keyof typeof all]))
    }
    case 'country':
      return field.props.limitTo[0] ?? 'GB'
    case 'short_text':
      return text(field.props.minLength, field.props.maxLength, 'Acme Industries')
    case 'long_text':
      return text(field.props.minLength, field.props.maxLength, 'Everything went smoothly, thank you.')
    case 'number': {
      const { min, max, allowDecimals } = field.props
      let n = 5
      if (min !== null && n < min) n = allowDecimals ? min : Math.ceil(min)
      if (max !== null && n > max) n = allowDecimals ? max : Math.floor(max)
      return n
    }
    case 'url':
      return 'https://example.com/portfolio'
    case 'date': {
      const today = opts.today ?? localToday()
      const { minDate, maxDate, disablePast, disableFuture } = field.props
      let d = disablePast ? addDays(today, 7) : disableFuture ? addDays(today, -7) : today
      if (minDate && d < minDate) d = minDate
      if (maxDate && d > maxDate) d = maxDate
      return d
    }
    case 'time': {
      const step = field.props.step
      const mins = Math.min(Math.ceil((9 * 60) / step) * step, 23 * 60 + 59 - ((23 * 60 + 59) % step))
      return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
    }
    case 'single_choice':
    case 'dropdown':
      return { option: field.props.options[0].id }
    case 'multiple_choice':
    case 'picture_choice': {
      const multiple = field.type === 'multiple_choice' || field.props.multiple
      const n = multiple ? Math.max(1, Math.min(field.props.minSelections ?? 1, field.props.options.length)) : 1
      return field.props.options.slice(0, n).map((o) => ({ option: o.id }))
    }
    case 'yes_no':
      return true
    case 'rating':
      return Math.min(4, field.props.scale)
    case 'nps':
      return 9
    case 'signature':
      return { url: SIGNATURE_PNG }
    case 'consent':
      return { accepted: true, at: new Date().toISOString() }
    case 'section_break':
      return undefined
  }
}

/**
 * Answers every visible storing field (or only required ones with `optional: false`), in field
 * order, re-running visibility after each answer.
 */
export function validAnswers(def: Pick<FormDefinition, 'fields'>, opts: AnswerOptions = {}): Answers {
  const answers: Answers = {}
  for (const f of def.fields) {
    if (!FIELD_TYPE_META[f.type].stores) continue
    if (!computeVisibility(def, answers).fields.has(f.id)) continue
    if (!f.required && opts.optional === false && !(opts.byId && f.id in opts.byId)) continue
    const v = opts.byId && f.id in opts.byId ? opts.byId[f.id] : opts.byType && f.type in opts.byType ? opts.byType[f.type] : validAnswer(f, opts)
    if (v !== undefined) answers[f.id] = v
  }
  // A later answer can hide an earlier-answered field only through backward rules, which
  // lintLogic forbids; still, drop anything that ended up hidden.
  const vis = computeVisibility(def, answers)
  for (const id of Object.keys(answers)) if (!vis.fields.has(id)) delete answers[id]
  return answers
}

/** Ids of the required fields that are visible for these answers. */
export function visibleRequired(def: Pick<FormDefinition, 'fields'>, answers: Answers = {}): string[] {
  const vis = computeVisibility(def, answers)
  return def.fields.filter((f) => f.required && FIELD_TYPE_META[f.type].stores && vis.fields.has(f.id)).map((f) => f.id)
}
