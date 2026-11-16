import * as z from 'zod/mini'
import { COUNTRY_CODES, countryName, isCountryCode } from './countries'
import {
  TEXT_OPS,
  activeValidators,
  base,
  defineType,
  evaluateText,
  isBlankString,
  isEmptyBasic,
  isRecord,
  single,
  str,
  CHOICE_OPS,
  type AnswerContext,
  type CoreField,
} from './common'

const def = z._default
const countryCode = z.string().check(z.length(2), z.refine(isCountryCode, 'Unknown country code'))

// ------------------------------------------------------------------ Email: trimmed lowercase string

/** zod's email pattern (z.regexes.email), copied so the whole regex table isn't bundled. */
export const EMAIL_RE = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/

const emailProps = z.object({
  /** Reject gmail.com etc. The list is server-only: see AnswerValidators.isFreeEmailDomain. */
  blockFreeDomains: def(z.boolean(), false),
})

export const email = defineType({
  ...base('email'),
  props: emailProps,
  defaultProps: () => emailProps.parse({}),
  answer(field, ctx?: AnswerContext) {
    const { isFreeEmailDomain } = activeValidators(ctx)
    const s = z.string({ error: 'invalidEmail' }).check(z.trim(), z.toLowerCase(), z.maxLength(254, 'invalidEmail'), z.regex(EMAIL_RE, 'invalidEmail'))
    if (field.props.blockFreeDomains && isFreeEmailDomain) {
      return s.check(z.refine((v: string) => !isFreeEmailDomain(v.slice(v.lastIndexOf('@') + 1)), 'freeEmail'))
    }
    return s
  },
  isEmpty: isEmptyBasic,
  operators: TEXT_OPS,
  evaluate: (op, a, v) => evaluateText(op, str(a), v),
  pipeParts: () => [],
  pipe: (v) => str(v),
  ...single(str),
})

// ------------------------------------------------------------------ Name: string, or {first,last} when split

const nameProps = z.object({
  /** false: one box, stored as a string. true: first + last, stored as { first, last }. */
  split: def(z.boolean(), false),
})

export interface NameAnswer {
  first: string
  last: string
}

function nameText(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (isRecord(v)) return [str(v.first).trim(), str(v.last).trim()].filter(Boolean).join(' ')
  return ''
}

export const name = defineType({
  ...base('name'),
  props: nameProps,
  defaultProps: () => nameProps.parse({}),
  answer(field) {
    if (!field.props.split) return z.string({ error: 'invalid' }).check(z.trim(), z.maxLength(200, 'maxChars:200'))
    const part = def(z.string().check(z.trim(), z.maxLength(100, 'maxChars:100')), '')
    return z
      .object({ first: part, last: part }, { error: 'invalid' })
      .check(z.refine((v: NameAnswer) => !field.required || v.first !== '', { message: 'required', path: ['first'] }))
  },
  isEmpty: (v) => nameText(v) === '',
  operators: TEXT_OPS,
  evaluate: (op, a, v) => evaluateText(op, nameText(a), v),
  pipeParts: (field) => (field.props.split ? ['first', 'last'] : []),
  pipe(v, part) {
    if (part === 'first') return typeof v === 'string' ? v.trim().split(/\s+/)[0] ?? '' : isRecord(v) ? str(v.first).trim() : ''
    if (part === 'last') {
      if (typeof v === 'string') return v.trim().split(/\s+/).slice(1).join(' ')
      return isRecord(v) ? str(v.last).trim() : ''
    }
    return nameText(v)
  },
  csvColumns: (field) => (field.props.split ? ['first name', 'last name'] : ['']),
  csv(v, field) {
    if (!field.props.split) return [nameText(v)]
    if (typeof v === 'string') return [v, '']
    return isRecord(v) ? [str(v.first), str(v.last)] : ['', '']
  },
  migrateProps: (from, old) => (from === 'name' ? { split: old.split === true } : {}),
})

// ------------------------------------------------------------------ Phone: E.164 string

const phoneProps = z.object({
  /** ISO alpha-2 country preselected in the dial-code picker. */
  defaultCountry: def(z.nullable(countryCode), null),
})

/** E.164: "+", country code, up to 15 digits in all. libphonenumber /max runs on the server. */
export const E164_RE = /^\+[1-9]\d{6,14}$/

/** Spaces, brackets, dots and dashes are ignored, as in the answer: "+1 (650) 253-0000" passes. */
export function isE164(v: unknown): boolean {
  return typeof v === 'string' && E164_RE.test(v.replace(/[\s().-]/g, ''))
}

export const phone = defineType({
  ...base('phone'),
  props: phoneProps,
  defaultProps: () => phoneProps.parse({}),
  answer(field, ctx?: AnswerContext) {
    const { phone: check } = activeValidators(ctx)
    const s = z.pipe(
      z.pipe(z.string({ error: 'invalidPhone' }), z.transform((v: string) => v.replace(/[\s().-]/g, ''))),
      z.string().check(z.regex(E164_RE, 'invalidPhone')),
    )
    return check ? s.check(z.refine((v: string) => check(v, field), 'invalidPhone')) : s
  },
  isEmpty: isEmptyBasic,
  operators: TEXT_OPS,
  evaluate(op, a, v) {
    // Compare digits only, so "+44 20…" matches "+4420…".
    if (op === 'is' || op === 'is_not') {
      if (isBlankString(a)) return false
      const same = str(a).replace(/[^\d+]/g, '') === str(v).replace(/[^\d+]/g, '')
      return op === 'is' ? same : !same
    }
    return evaluateText(op, str(a), v)
  },
  pipeParts: () => [],
  pipe: (v) => str(v),
  ...single(str),
})

// ------------------------------------------------------------------ Address: object of enabled lines

export const ADDRESS_LINES = ['street', 'line2', 'city', 'state', 'postal', 'country'] as const
export type AddressLine = (typeof ADDRESS_LINES)[number]
/** Lines that must be filled when the field is required (and the line is enabled). */
const REQUIRED_LINES: readonly AddressLine[] = ['street', 'city', 'country']

const addressProps = z.object({
  lines: def(
    z.object({
      street: def(z.boolean(), true),
      line2: def(z.boolean(), true),
      city: def(z.boolean(), true),
      state: def(z.boolean(), true),
      postal: def(z.boolean(), true),
      country: def(z.boolean(), true),
    }),
    { street: true, line2: true, city: true, state: true, postal: true, country: true },
  ),
  defaultCountry: def(z.nullable(countryCode), null),
})

export type AddressAnswer = Partial<Record<AddressLine, string>>

function enabledLines(field: CoreField<z.output<typeof addressProps>>): AddressLine[] {
  return ADDRESS_LINES.filter((l) => field.props.lines[l])
}

function addressText(v: unknown): string {
  if (!isRecord(v)) return ''
  return ADDRESS_LINES.map((l) => (l === 'country' && isCountryCode(v[l]) ? countryName(v[l]) : str(v[l]).trim()))
    .filter(Boolean)
    .join(', ')
}

export const address = defineType({
  ...base('address'),
  props: addressProps,
  defaultProps: () => addressProps.parse({}),
  answer(field) {
    const shape: Record<string, z.ZodMiniType> = {}
    for (const line of enabledLines(field)) {
      const required = field.required && REQUIRED_LINES.includes(line)
      if (line === 'country') {
        shape[line] = required
          ? z.string({ error: 'invalidCountry' }).check(z.refine(isCountryCode, 'invalidCountry'))
          : z.optional(z.union([z.literal(''), z.string().check(z.refine(isCountryCode, 'invalidCountry'))]))
      } else {
        const s = z.string({ error: 'invalid' }).check(z.trim(), z.maxLength(200, 'maxChars:200'))
        shape[line] = required ? s.check(z.minLength(1, 'required')) : z.optional(s)
      }
    }
    // Unknown and disabled lines are stripped; blank optional lines are dropped.
    return z.pipe(
      z.object(shape, { error: 'invalid' }),
      z.transform((v: Record<string, unknown>) => {
        const out: AddressAnswer = {}
        for (const [k, val] of Object.entries(v)) if (typeof val === 'string' && val !== '') out[k as AddressLine] = val
        return out
      }),
    )
  },
  isEmpty: (v) => !isRecord(v) || ADDRESS_LINES.every((l) => isBlankString(v[l])),
  operators: TEXT_OPS,
  evaluate: (op, a, v) => evaluateText(op, addressText(a), v),
  pipeParts: () => ADDRESS_LINES,
  pipe(v, part) {
    if (!isRecord(v)) return ''
    if (part && (ADDRESS_LINES as readonly string[]).includes(part)) {
      const val = str(v[part]).trim()
      return part === 'country' && isCountryCode(val) ? countryName(val) : val
    }
    return addressText(v)
  },
  csvColumns: (field) => enabledLines(field),
  csv: (v, field) => enabledLines(field).map((l) => (isRecord(v) ? str(v[l]) : '')),
  migrateProps: (from, old) => (from === 'address' ? z.partial(addressProps).safeParse(old).data ?? {} : {}),
})

// ------------------------------------------------------------------ Country: ISO alpha-2

const countryProps = z.object({
  defaultCountry: def(z.nullable(countryCode), null),
  /** Offer only these countries. Empty = all. */
  limitTo: def(z.array(countryCode).check(z.maxLength(COUNTRY_CODES.length)), []),
})

export const country = defineType({
  ...base('country'),
  props: countryProps,
  defaultProps: () => countryProps.parse({}),
  answer(field) {
    const allowed = field.props.limitTo.length ? new Set(field.props.limitTo) : null
    return z
      .string({ error: 'invalidCountry' })
      .check(z.trim(), z.toUpperCase(), z.refine((c: string) => isCountryCode(c) && (!allowed || allowed.has(c)), 'invalidCountry'))
  },
  isEmpty: isEmptyBasic,
  operators: CHOICE_OPS,
  evaluate(op, a, v) {
    if (op === 'is_empty') return isBlankString(a)
    if (op === 'is_not_empty') return !isBlankString(a)
    if (isBlankString(a)) return false
    const same = str(a).toUpperCase() === str(v).toUpperCase()
    return op === 'is' ? same : op === 'is_not' ? !same : false
  },
  pipeParts: () => ['code'],
  pipe: (v, part) => (part === 'code' ? str(v) : isCountryCode(v) ? countryName(v) : str(v)),
  ...single((v) => str(v)),
  migrateProps: (from, old) =>
    from === 'country' || from === 'phone' || from === 'address'
      ? { defaultCountry: isCountryCode(old.defaultCountry) ? old.defaultCountry : null }
      : {},
})
