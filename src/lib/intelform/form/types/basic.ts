import * as z from 'zod/mini'
import {
  DATE_OPS,
  NUMBER_OPS,
  TEXT_OPS,
  addDays,
  base,
  defineType,
  evaluateNumber,
  evaluateOrdered,
  evaluateText,
  isEmptyBasic,
  localDate,
  single,
  str,
  textSchema,
  toNumber,
  type AnswerContext,
} from './common'
import { answerPlainText, htmlToPlain, isBlankHtml, isRichAnswer, plainToHtml, sanitizeRichText, type RichAnswer } from '../rich-text'

/** Shorthands for zod/mini, which has functions instead of methods. */
const int = (min: number, max: number) => z.number().check(z.int(), z.gte(min), z.lte(max))
const def = z._default

const lengthLimit = (cap: number) => def(z.nullable(int(0, cap)), null)

/** Short/long text share min/max characters on a type change. */
function migrateText(old: Record<string, unknown>) {
  const out: { minLength?: number | null; maxLength?: number | null } = {}
  if (typeof old.minLength === 'number') out.minLength = old.minLength
  if (typeof old.maxLength === 'number') out.maxLength = old.maxLength
  return out
}

// ------------------------------------------------------------------ Rich text answers

/** Empty plain text, or a rich `{html}` answer that shows no text. */
function isEmptyText(v: unknown): boolean {
  return isRichAnswer(v) ? isBlankHtml(v.html) : isEmptyBasic(v)
}

/**
 * A rich text answer: `{html}` (or plain text from an older page, kept as paragraphs). Stored as
 * the sanitized subset; min / max characters count the visible text, not the formatting.
 */
function richTextAnswerSchema(min: number | null, max: number, htmlMax: number, inline: boolean): z.ZodMiniType<RichAnswer> {
  return z.pipe(
    z.union([z.string(), z.object({ html: z.string() })], { error: 'invalid' }),
    z.transform((v, ctx): RichAnswer => {
      const issue = (message: string) => ctx.issues.push({ code: 'custom', message, input: v })
      const raw = typeof v === 'string' ? plainToHtml(v, inline) : v.html
      // Refuse absurd input before parsing it; the stored size is checked again once clean.
      if (raw.length > htmlMax * 4) {
        issue(`maxChars:${max}`)
        return { html: '' }
      }
      const html = sanitizeRichText(raw, { inline })
      const length = htmlToPlain(html).trim().length
      if (length > max || html.length > htmlMax) issue(`maxChars:${max}`)
      else if (min && length < min) issue(`minChars:${min}`)
      return { html }
    }),
  )
}

// ------------------------------------------------------------------ Short text

export const SHORT_TEXT_MAX = 1000
export const LONG_TEXT_MAX = 10000
/** Longest stored HTML of a rich text answer (formatting included); the text limits still apply. */
export const SHORT_TEXT_HTML_MAX = 8000
export const LONG_TEXT_HTML_MAX = 60_000

const shortTextProps = z.object({
  minLength: lengthLimit(SHORT_TEXT_MAX),
  maxLength: lengthLimit(SHORT_TEXT_MAX),
  /** Respondents get a formatting toolbar (bold, italic, underline, strikethrough, links). */
  richText: def(z.boolean(), false),
})

export const short_text = defineType({
  ...base('short_text'),
  props: shortTextProps,
  defaultProps: () => shortTextProps.parse({}),
  answer: (field) => {
    const max = Math.min(field.props.maxLength ?? SHORT_TEXT_MAX, SHORT_TEXT_MAX)
    return field.props.richText
      ? richTextAnswerSchema(field.props.minLength, max, SHORT_TEXT_HTML_MAX, true)
      : textSchema(field.props.minLength, max)
  },
  isEmpty: isEmptyText,
  operators: TEXT_OPS,
  evaluate: (op, a, v) => evaluateText(op, answerPlainText(a), v),
  pipeParts: () => [],
  pipe: (v) => answerPlainText(v),
  ...single(answerPlainText),
  migrateProps: (_from, old) => {
    const m = migrateText(old)
    return {
      minLength: m.minLength == null ? m.minLength : Math.min(m.minLength, SHORT_TEXT_MAX),
      maxLength: m.maxLength == null ? m.maxLength : Math.min(m.maxLength, SHORT_TEXT_MAX),
      ...(typeof old.richText === 'boolean' && { richText: old.richText }),
    }
  },
})

// ------------------------------------------------------------------ Long text

const longTextProps = z.object({
  minLength: lengthLimit(LONG_TEXT_MAX),
  maxLength: lengthLimit(LONG_TEXT_MAX),
  rows: def(int(2, 20), 4),
  /** Respondents get a formatting toolbar (also lists and line breaks). */
  richText: def(z.boolean(), false),
})

export const long_text = defineType({
  ...base('long_text'),
  props: longTextProps,
  defaultProps: () => longTextProps.parse({}),
  answer: (field) => {
    const max = Math.min(field.props.maxLength ?? LONG_TEXT_MAX, LONG_TEXT_MAX)
    return field.props.richText
      ? richTextAnswerSchema(field.props.minLength, max, LONG_TEXT_HTML_MAX, false)
      : textSchema(field.props.minLength, max)
  },
  isEmpty: isEmptyText,
  operators: TEXT_OPS,
  evaluate: (op, a, v) => evaluateText(op, answerPlainText(a), v),
  pipeParts: () => [],
  pipe: (v) => answerPlainText(v),
  ...single(answerPlainText),
  migrateProps: (_from, old) => {
    const m = migrateText(old)
    return {
      ...(m.minLength !== undefined && { minLength: m.minLength }),
      ...(m.maxLength !== undefined && { maxLength: m.maxLength }),
      ...(typeof old.richText === 'boolean' && { richText: old.richText }),
    }
  },
})

// ------------------------------------------------------------------ Number

const numberProps = z.object({
  min: def(z.nullable(z.number()), null),
  max: def(z.nullable(z.number()), null),
  allowDecimals: def(z.boolean(), true),
  prefix: def(z.string().check(z.maxLength(10)), ''),
  suffix: def(z.string().check(z.maxLength(10)), ''),
})

export const number = defineType({
  ...base('number'),
  props: numberProps,
  defaultProps: () => numberProps.parse({}),
  answer(field) {
    const { min, max, allowDecimals } = field.props
    // Accept numeric strings ("12.5") as well, for robustness; store a number.
    // z.number() rejects NaN and ±Infinity.
    const checks: z.core.$ZodCheck<number>[] = []
    if (!allowDecimals) checks.push(z.refine(Number.isInteger, 'wholeNumber'))
    if (min !== null) checks.push(z.refine((x: number) => x >= min, `numberMin:${min}`))
    if (max !== null) checks.push(z.refine((x: number) => x <= max, `numberMax:${max}`))
    const n = z.number({ error: 'invalidNumber' })
    return z.pipe(
      z.transform((v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : v)),
      checks.length ? n.check(...checks) : n,
    )
  },
  isEmpty: (v) => toNumber(v) === undefined,
  operators: NUMBER_OPS,
  evaluate: (op, a, v) => evaluateNumber(op, toNumber(a), v),
  pipeParts: () => [],
  pipe: (v, _part, field) => {
    const n = toNumber(v)
    return n === undefined ? '' : `${field.props.prefix}${n}${field.props.suffix}`
  },
  ...single((v) => (toNumber(v) === undefined ? '' : String(toNumber(v)))),
  migrateProps: (from, old) => {
    if (from === 'number') return z.partial(numberProps).safeParse(old).data ?? {}
    return {}
  },
})

// ------------------------------------------------------------------ URL

/** Respondents can type "example.com"; it is stored as "https://example.com". */
function normaliseUrl(v: string): string {
  const t = v.trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
}

function isRespondentUrl(v: string): boolean {
  if (v.length > 2048) return false
  try {
    const u = new URL(v)
    return (u.protocol === 'http:' || u.protocol === 'https:') && /\.[a-z0-9-]{2,}$/i.test(u.hostname)
  } catch {
    return false
  }
}

const urlProps = z.object({})

export const url = defineType({
  ...base('url'),
  props: urlProps,
  defaultProps: () => ({}),
  answer: () => z.pipe(z.string({ error: 'invalidUrl' }), z.transform(normaliseUrl)).check(z.refine(isRespondentUrl, 'invalidUrl')),
  isEmpty: isEmptyBasic,
  operators: TEXT_OPS,
  evaluate: (op, a, v) => evaluateText(op, str(a), v),
  pipeParts: () => [],
  pipe: (v) => str(v),
  ...single(str),
})

// ------------------------------------------------------------------ Date: "YYYY-MM-DD"

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = ISO_DATE_RE.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

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

const isoDate = z.string().check(z.refine(isIsoDate, 'Use YYYY-MM-DD'))

const dateProps = z.object({
  format: def(z.enum(DATE_FORMATS), 'DD/MM/YYYY'),
  minDate: def(z.nullable(isoDate), null),
  maxDate: def(z.nullable(isoDate), null),
  disablePast: def(z.boolean(), false),
  disableFuture: def(z.boolean(), false),
})

export const date = defineType({
  ...base('date'),
  props: dateProps,
  defaultProps: () => dateProps.parse({}),
  answer(field, ctx?: AnswerContext) {
    const { format, minDate, maxDate, disablePast, disableFuture } = field.props
    const today = ctx?.today ?? localDate(ctx?.now ?? new Date())
    const slack = ctx?.dayTolerance ?? 1
    const checks: z.core.$ZodCheck<string>[] = [z.trim(), z.refine(isIsoDate, 'invalidDate')]
    if (minDate) checks.push(z.refine((v: string) => v >= minDate, `dateMin:${formatDate(minDate, format)}`))
    if (maxDate) checks.push(z.refine((v: string) => v <= maxDate, `dateMax:${formatDate(maxDate, format)}`))
    if (disablePast) checks.push(z.refine((v: string) => v >= addDays(today, -slack), 'datePast'))
    if (disableFuture) checks.push(z.refine((v: string) => v <= addDays(today, slack), 'dateFuture'))
    return z.string({ error: 'invalidDate' }).check(...checks)
  },
  isEmpty: (v) => !isIsoDate(v),
  operators: DATE_OPS,
  evaluate: (op, a, v) => evaluateOrdered(op, isIsoDate(a) ? a : undefined, v),
  pipeParts: () => [],
  pipe: (v, _part, field) => (isIsoDate(v) ? formatDate(v, field.props.format) : ''),
  ...single((v) => (isIsoDate(v) ? v : '')),
  migrateProps: (from, old) => (from === 'date' ? z.partial(dateProps).safeParse(old).data ?? {} : {}),
})

// ------------------------------------------------------------------ Time: "HH:mm" (24 h)

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v)
}

/** "14:05" → "2:05 PM" for 12-hour fields. */
export function formatTime(hhmm: string, hourCycle: '12' | '24'): string {
  if (hourCycle === '24' || !isTime(hhmm)) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const timeProps = z.object({
  hourCycle: def(z.enum(['12', '24']), '24'),
  /** Minute step for the picker; answers must land on it (counted from 00:00). */
  step: def(int(1, 60), 15),
})

export const time = defineType({
  ...base('time'),
  props: timeProps,
  defaultProps: () => timeProps.parse({}),
  answer(field) {
    const step = field.props.step
    return z.string({ error: 'invalidTime' }).check(
      z.trim(),
      z.regex(TIME_RE, 'invalidTime'),
      z.refine((v: string) => {
        const [h, m] = v.split(':').map(Number)
        return (h * 60 + m) % step === 0
      }, `timeStep:${step}`),
    )
  },
  isEmpty: (v) => !isTime(v),
  operators: DATE_OPS,
  evaluate: (op, a, v) => evaluateOrdered(op, isTime(a) ? a : undefined, v),
  pipeParts: () => [],
  pipe: (v, _part, field) => (isTime(v) ? formatTime(v, field.props.hourCycle) : ''),
  ...single((v) => (isTime(v) ? v : '')),
  migrateProps: (from, old) => (from === 'time' ? z.partial(timeProps).safeParse(old).data ?? {} : {}),
})
