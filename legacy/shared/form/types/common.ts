import * as z from 'zod/mini'
import { OTHER_OPTION_ID, newOptionId, optionId, type ConditionOp } from '../base'
import type { FieldGroup, FieldType } from '../field-types'
import { FIELD_TYPE_META } from '../field-types'
import { safeUrlMini } from '../safe-url-core'

/**
 * Every schema in the registry is zod/mini (`import * as z from 'zod/mini'`): the respondent
 * bundle validates answers with them, and mini tree-shakes to a few KB. Mini schemas work
 * anywhere a zod 4 schema is accepted (classic `z.object({ x: miniSchema })`, `z.infer`,
 * `.parse` / `.safeParse`); chain with `z.optional(s)`, `s.check(z.maxLength(n))`… instead of methods.
 *
 * The pure (no React) half of a field type. One per type in `registry.ts`; the React half
 * lives in src/form-types/. See docs/research/02-builder.md "Field-type registry interface".
 *
 * Functions that read answers (`isEmpty`, `evaluate`, `pipe`, `csv`) take `unknown` and must
 * never throw: logic runs on raw, unvalidated respondent input.
 */
export interface FieldTypeCore<T extends FieldType = FieldType, P extends z.ZodMiniType = z.ZodMiniType> {
  readonly type: T
  readonly group: FieldGroup
  readonly label: string
  /** Section break stores nothing. */
  readonly stores: boolean
  readonly hasPlaceholder: boolean
  /** Per-type settings. Every key has a default, so `props.parse({})` gives the defaults. */
  readonly props: P
  defaultProps(): z.output<P>
  /**
   * Answer validator for a non-empty answer (required is handled by logic.validateSubmission).
   * Error messages are label codes ("minChars:5"); see labels.errorMessage.
   * The output is the normalised value to store (trimmed, lowercased email, etc.).
   */
  answer(field: CoreField<z.output<P>>, ctx?: AnswerContext): z.ZodMiniType
  /** True for undefined, null, "", [], an all-blank name/address, an unticked consent… */
  isEmpty(value: unknown): boolean
  /** Operators offered in the logic editor for this type as a source (PRD Logic table). */
  readonly operators: readonly ConditionOp[]
  /** Evaluate one condition. An empty answer only matches is_empty (and is_no for consent). */
  evaluate(op: ConditionOp, answer: unknown, value: unknown, field: CoreField<z.output<P>>): boolean
  /** Pipe parts besides the default, e.g. ["first", "last"] for a split name. */
  pipeParts(field: CoreField<z.output<P>>): readonly string[]
  /** Text for {f_x} / {f_x.part}. Only called with a non-empty answer. */
  pipe(value: unknown, part: string | undefined, field: CoreField<z.output<P>>): string
  /** Column header suffixes; one entry = one column. [''] = a single column named by the label. */
  csvColumns(field: CoreField<z.output<P>>): string[]
  /** CSV cells, same length as csvColumns. Plain text: CSV escaping is the server's job. */
  csv(value: unknown, field: CoreField<z.output<P>>): string[]
  /** On a type change: the settings that carry over from the old type. */
  migrateProps?(from: FieldType, old: Record<string, unknown>): Partial<z.output<P>>
}

/** The parts of a field the registry needs. Every FormField is assignable to it. */
export interface CoreField<P = unknown> {
  id: string
  type: FieldType
  label: string
  description?: string
  required: boolean
  requiredError?: string
  props: P
}

/**
 * Server-only checks the shared code cannot bundle (libphonenumber /max metadata, the
 * free-email-domains list). Plug them in once at server start with `configureValidators`,
 * or per call through `AnswerContext.validators`.
 */
export interface AnswerValidators {
  /** Return false to reject a syntactically valid E.164 number. */
  phone?: (e164: string, field: CoreField) => boolean
  /** Return true when the lowercase domain is a free email provider (gmail.com…). */
  isFreeEmailDomain?: (domain: string) => boolean
}

let configured: AnswerValidators = {}

/** Install validators for every answer schema built afterwards (call once at server start). */
export function configureValidators(validators: AnswerValidators): void {
  configured = { ...configured, ...validators }
}

export function activeValidators(ctx?: AnswerContext): AnswerValidators {
  return { ...configured, ...ctx?.validators }
}

export interface AnswerContext {
  validators?: AnswerValidators
  /** "Today" as YYYY-MM-DD for disable past/future. Defaults to the local date of `now`. */
  today?: string
  /** Days of slack for disable past/future (time zones). Default 1; the browser can pass 0. */
  dayTolerance?: number
  /** Server time. When set, consent `at` is stamped with it instead of the client's value. */
  now?: Date
  /** Stamped into consent answers. */
  formVersion?: number
}

// ---------------------------------------------------------------------------------------
// Operator sets (PRD Logic table). is_not_empty is added everywhere as a convenience.

export const TEXT_OPS = ['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] as const satisfies readonly ConditionOp[]
export const NUMBER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'] as const satisfies readonly ConditionOp[]
export const DATE_OPS = ['is', 'before', 'after', 'is_empty', 'is_not_empty'] as const satisfies readonly ConditionOp[]
export const CHOICE_OPS = ['is', 'is_not', 'is_empty', 'is_not_empty'] as const satisfies readonly ConditionOp[]
export const MULTI_OPS = ['includes', 'not_includes', 'is_empty', 'is_not_empty'] as const satisfies readonly ConditionOp[]
export const BOOL_OPS = ['is_yes', 'is_no'] as const satisfies readonly ConditionOp[]
export const PRESENCE_OPS = ['is_empty', 'is_not_empty'] as const satisfies readonly ConditionOp[]

// ---------------------------------------------------------------------------------------
// Small helpers

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isBlankString(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

/** Generic emptiness: undefined, null, blank string, empty array. */
export function isEmptyBasic(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

export function str(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Case- and whitespace-insensitive comparison used by text operators. */
export function norm(v: unknown): string {
  return str(v).trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Text operators over a string projection of the answer. */
export function evaluateText(op: ConditionOp, text: string, value: unknown): boolean {
  if (op === 'is_empty') return text.trim() === ''
  if (op === 'is_not_empty') return text.trim() !== ''
  if (text.trim() === '') return false
  const a = norm(text)
  const b = norm(value)
  switch (op) {
    case 'is':
      return a === b
    case 'is_not':
      return a !== b
    case 'contains':
      return b !== '' && a.includes(b)
    case 'not_contains':
      return b === '' || !a.includes(b)
    default:
      return false
  }
}

export function evaluateNumber(op: ConditionOp, n: number | undefined, value: unknown): boolean {
  if (op === 'is_empty') return n === undefined
  if (op === 'is_not_empty') return n !== undefined
  const b = toNumber(value)
  if (n === undefined || b === undefined) return false
  switch (op) {
    case 'eq':
      return n === b
    case 'neq':
      return n !== b
    case 'gt':
      return n > b
    case 'gte':
      return n >= b
    case 'lt':
      return n < b
    case 'lte':
      return n <= b
    default:
      return false
  }
}

/** ISO dates and HH:mm times compare correctly as strings. */
export function evaluateOrdered(op: ConditionOp, a: string | undefined, value: unknown): boolean {
  if (op === 'is_empty') return a === undefined
  if (op === 'is_not_empty') return a !== undefined
  const b = str(value).trim()
  if (a === undefined || b === '') return false
  switch (op) {
    case 'is':
      return a === b
    case 'before':
      return a < b
    case 'after':
      return a > b
    default:
      return false
  }
}

/** A zod string that trims and checks min/max length, with label-code errors. */
export function textSchema(min: number | null | undefined, max: number): z.ZodMiniType<string> {
  const s = z.string({ error: 'invalid' }).check(z.trim(), z.maxLength(max, `maxChars:${max}`))
  return min ? s.check(z.minLength(min, `minChars:${min}`)) : s
}

/** Default and filled-in csvColumns/csv for a single-column type. */
export function single(format: (v: unknown) => string) {
  return {
    csvColumns: (): string[] => [''],
    csv: (v: unknown): string[] => [format(v)],
  }
}

// ---------------------------------------------------------------------------------------
// Options (choice, dropdown, picture choice)

export const choiceOption = z.object({
  id: optionId,
  label: z._default(z.string().check(z.maxLength(500)), ''),
})
export type ChoiceOption = z.infer<typeof choiceOption>

export const pictureOption = z.object({
  id: optionId,
  label: z._default(z.string().check(z.maxLength(500)), ''),
  imageUrl: z._default(z.nullable(safeUrlMini), null),
  /** Alt text; falls back to the label. The pre-publish a11y check warns when both are empty. */
  alt: z.optional(z.string().check(z.maxLength(500))),
})
export type PictureOption = z.infer<typeof pictureOption>

/** Option list: unique ids, OTHER_OPTION_ID reserved. Empty is allowed in drafts. */
export function optionList<T extends z.ZodMiniType<{ id: string }>>(item: T, defaults: () => z.output<T>[]) {
  return z._default(
    z.array(item).check(
      z.maxLength(200),
      z.refine((opts) => new Set(opts.map((o) => o.id)).size === opts.length, 'Option ids must be unique'),
      z.refine((opts) => opts.every((o) => o.id !== OTHER_OPTION_ID), `${OTHER_OPTION_ID} is reserved for "Other"`),
    ),
    defaults,
  )
}

export function defaultOptions(n = 2): ChoiceOption[] {
  return Array.from({ length: n }, (_, i) => ({ id: newOptionId(), label: `Option ${i + 1}` }))
}

/**
 * Choice answer encoding, shared by single choice, dropdown, multiple choice and picture choice:
 * `{ option: "o_a1" }`, or `{ option: "o_other", other: "their text" }` for "Other".
 * Single choice and dropdown store one ChoiceAnswer; multiple and picture choice store an array.
 */
export interface ChoiceAnswer {
  option: string
  other?: string
}

export function isChoiceAnswer(v: unknown): v is ChoiceAnswer {
  return isRecord(v) && typeof v.option === 'string' && v.option !== ''
}

export function choiceAnswerSchema(ids: Set<string>, allowOther: boolean): z.ZodMiniType<ChoiceAnswer> {
  return z.pipe(
    z.object({ option: z.string({ error: 'invalidChoice' }), other: z.optional(z.string()) }, { error: 'invalidChoice' }),
    z.transform((v, ctx): ChoiceAnswer => {
      const issue = (message: string) => ctx.issues.push({ code: 'custom', message, input: v })
      if (allowOther && v.option === OTHER_OPTION_ID) {
        const other = (v.other ?? '').trim()
        if (other === '') issue('otherRequired')
        else if (other.length > 500) issue('maxChars:500')
        return { option: OTHER_OPTION_ID, other }
      }
      if (!ids.has(v.option)) issue('invalidChoice')
      return { option: v.option }
    }),
  )
}

export function optionLabel(
  options: readonly { id: string; label: string }[],
  answer: ChoiceAnswer,
  otherLabel = 'Other',
): string {
  if (answer.option === OTHER_OPTION_ID) return answer.other ? answer.other : otherLabel
  return options.find((o) => o.id === answer.option)?.label ?? answer.option
}

/** Option-carrying props survive a change between any two choice types. */
export function migrateOptions(old: Record<string, unknown>): { options?: ChoiceOption[] } {
  if (!Array.isArray(old.options)) return {}
  const options = old.options
    .filter(isRecord)
    .filter((o) => typeof o.id === 'string' && o.id !== OTHER_OPTION_ID)
    .map((o) => ({ id: String(o.id), label: str(o.label) }))
  return options.length ? { options } : {}
}

export function base<T extends FieldType>(type: T) {
  const meta = FIELD_TYPE_META[type]
  return { type, group: meta.group, label: meta.label, stores: meta.stores, hasPlaceholder: meta.hasPlaceholder }
}

/** Identity helper so each type's generics are inferred. */
export function defineType<T extends FieldType, P extends z.ZodMiniType>(core: FieldTypeCore<T, P>): FieldTypeCore<T, P> {
  return core
}

/** Local calendar date as YYYY-MM-DD (never toISOString, which shifts the day). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}
