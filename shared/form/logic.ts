import { OTHER_OPTION_ID, VALUELESS_OPS, type Condition, type LogicRule } from './base'
import type { FormDefinition, FormField } from './definition'
import { FIELD_TYPE_META } from './field-types'
import { errorMessage, resolveLabels, type Labels } from './labels'
import { isIsoDate, isTime } from './types/basic'
import type { AnswerContext } from './types/common'
import { coreRegistry } from './types/registry'

/**
 * Show/hide logic, answer piping and submission validation. Pure functions, shared by the
 * respondent renderer, the builder and the server (the server is the source of truth).
 *
 * Rules may only reference earlier fields, so one forward pass decides visibility:
 * - a hidden source counts as empty;
 * - empty answers only match is_empty (and is_no for consent);
 * - a rule on a section break shows or hides its whole page;
 * - pages with no visible fields are skipped.
 */

export type Answers = Record<string, unknown>

export interface Visibility {
  /** Visible field ids, visible section breaks included. */
  fields: Set<string>
  /** Visible non-break field ids per page, in order. Pages with no visible field are left out. */
  pages: string[][]
  /** Parallel to `pages`: the section break id that starts each page (null for a leading page without one). */
  pageSections: (string | null)[]
}

type Def = Pick<FormDefinition, 'fields'>

const indexCache = new WeakMap<readonly FormField[], Map<string, { field: FormField; index: number }>>()

function indexOf(def: Def): Map<string, { field: FormField; index: number }> {
  let map = indexCache.get(def.fields)
  if (!map) {
    map = new Map(def.fields.map((field, index) => [field.id, { field, index }]))
    indexCache.set(def.fields, map)
  }
  return map
}

function evaluateCondition(c: Condition, def: Def, answers: Answers, visible: Set<string>): boolean {
  const src = indexOf(def).get(c.field)?.field
  if (!src) return false
  const core = coreRegistry[src.type]
  if (!core.operators.includes(c.op)) return false
  const answer = visible.has(src.id) ? answers[src.id] : undefined
  try {
    return core.evaluate(c.op, answer, c.value, src)
  } catch {
    return false
  }
}

/** True when the rule's target should be shown. `visible` holds the sources already shown. */
export function evaluateRule(rule: LogicRule, def: Def, answers: Answers, visible: Set<string>): boolean {
  const results = rule.conditions.map((c) => evaluateCondition(c, def, answers, visible))
  const matched = rule.match === 'all' ? results.every(Boolean) : results.some(Boolean)
  return rule.action === 'show' ? matched : !matched
}

/** One forward pass over the fields. */
export function computeVisibility(def: Def, answers: Answers): Visibility {
  const visible = new Set<string>()
  const pages: { section: string | null; ids: string[] }[] = []
  let page: { section: string | null; ids: string[] } = { section: null, ids: [] }
  pages.push(page)
  let pageVisible = true
  for (const f of def.fields) {
    if (f.type === 'section_break') {
      pageVisible = !f.logic || evaluateRule(f.logic, def, answers, visible)
      page = { section: f.id, ids: [] }
      pages.push(page)
      if (pageVisible) visible.add(f.id)
      continue
    }
    if (!pageVisible) continue
    if (f.logic && !evaluateRule(f.logic, def, answers, visible)) continue
    visible.add(f.id)
    page.ids.push(f.id)
  }
  const kept = pages.filter((p) => p.ids.length > 0)
  return { fields: visible, pages: kept.map((p) => p.ids), pageSections: kept.map((p) => p.section) }
}

/**
 * Keep only answers to visible, storing fields, and drop empty ones. Idempotent, and it never
 * changes visibility (a hidden or empty source already counts as empty).
 */
export function pruneAnswers(def: Def, answers: Answers): Answers {
  const vis = computeVisibility(def, answers)
  const out: Answers = {}
  for (const f of def.fields) {
    if (!FIELD_TYPE_META[f.type].stores || !vis.fields.has(f.id)) continue
    if (!Object.hasOwn(answers, f.id)) continue
    const v = answers[f.id]
    if (coreRegistry[f.type].isEmpty(v)) continue
    out[f.id] = v
  }
  return out
}

export interface ValidateOptions {
  /** Extra label overrides on top of definition.labels. */
  labels?: Record<string, string>
  /** Validators, today, server time and form version for the answer schemas. */
  context?: AnswerContext
  /** What to do with a non-empty answer to a hidden field. Default 'reject' (PRD). */
  hidden?: 'reject' | 'drop'
}

export type ValidationResult = { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> }

function fieldError(f: FormField, code: string, labels: Labels): string {
  if (code === 'required') return f.requiredError?.trim() || labels.required
  return errorMessage(code, labels)
}

/** Check one field's answer. Returns the normalised value, or an error message. */
export function validateField(
  f: FormField,
  value: unknown,
  labels: Labels,
  context?: AnswerContext,
): { ok: true; value: unknown; empty: boolean } | { ok: false; error: string } {
  const core = coreRegistry[f.type]
  if (!core.stores) return { ok: true, value: undefined, empty: true }
  if (core.isEmpty(value)) {
    return f.required ? { ok: false, error: fieldError(f, 'required', labels) } : { ok: true, value: undefined, empty: true }
  }
  const result = core.answer(f, context).safeParse(value)
  if (!result.success) return { ok: false, error: fieldError(f, result.error.issues[0]?.message ?? 'invalid', labels) }
  return { ok: true, value: result.data, empty: false }
}

/**
 * Browser helper for Next / Submit: errors for the given (visible) fields only.
 * Fields that are hidden right now are skipped.
 */
export function validatePage(
  def: FormDefinition,
  answers: Answers,
  fieldIds: readonly string[],
  opts: Omit<ValidateOptions, 'hidden'> = {},
): Record<string, string> {
  const labels = resolveLabels({ ...def.labels, ...opts.labels })
  const vis = computeVisibility(def, answers)
  const errors: Record<string, string> = {}
  for (const id of fieldIds) {
    const f = indexOf(def).get(id)?.field
    if (!f || !vis.fields.has(id)) continue
    const r = validateField(f, answers[id], labels, opts.context)
    if (!r.ok) errors[id] = r.error
  }
  return errors
}

/**
 * Server (and final client) check: re-run visibility, reject or drop answers to hidden
 * fields, require only visible required fields, validate every answer with its type.
 * Unknown keys and section breaks are dropped. Errors are keyed by field id ("_form" for
 * a body that is not an object).
 */
export function validateSubmission(def: FormDefinition, raw: unknown, opts: ValidateOptions = {}): ValidationResult {
  const labels = resolveLabels({ ...def.labels, ...opts.labels })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { _form: labels.invalid } }
  }
  const input = raw as Answers
  const vis = computeVisibility(def, input)
  const errors: Record<string, string> = {}
  const answers: Answers = {}
  for (const f of def.fields) {
    const core = coreRegistry[f.type]
    if (!core.stores) continue
    const present = Object.hasOwn(input, f.id)
    if (!vis.fields.has(f.id)) {
      if (present && !core.isEmpty(input[f.id]) && (opts.hidden ?? 'reject') === 'reject') errors[f.id] = labels.hiddenField
      continue
    }
    const r = validateField(f, present ? input[f.id] : undefined, labels, opts.context)
    if (!r.ok) errors[f.id] = r.error
    else if (!r.empty) answers[f.id] = r.value
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers }
}

// ---------------------------------------------------------------------------------------
// Builder checks

export type LogicIssueCode =
  | 'missing_source'
  | 'self_reference'
  | 'later_source'
  | 'invalid_source'
  | 'bad_operator'
  | 'missing_value'
  | 'bad_value'
  | 'unknown_option'
  | 'pipe_missing'
  | 'pipe_later'

export interface LogicIssue {
  code: LogicIssueCode
  /** The field holding the rule or pipe; "startScreen" / "endScreen" for screen text. */
  fieldId: string
  conditionIndex?: number
  /** The referenced field id. */
  source?: string
  message: string
}

function name(f: FormField | undefined): string {
  return f && f.label.trim() ? `"${f.label.trim().replace(PIPE_RE, '…')}"` : 'an untitled question'
}

/**
 * Integrity check for save / publish: references to missing, later, self or non-storing
 * fields; operators that don't fit the source type; missing or malformed values; option
 * ids that no longer exist; pipes to missing or later fields. Every issue blocks publish.
 */
export function lintLogic(def: FormDefinition): LogicIssue[] {
  const issues: LogicIssue[] = []
  const idx = indexOf(def)
  def.fields.forEach((target, ti) => {
    target.logic?.conditions.forEach((c, ci) => {
      const at = { fieldId: target.id, conditionIndex: ci, source: c.field }
      const entry = idx.get(c.field)
      const src = entry?.field
      if (!entry || !src) {
        issues.push({ ...at, code: 'missing_source', message: `A rule on ${name(target)} uses a question that was deleted. Pick another question or remove the condition.` })
        return
      }
      if (src.id === target.id) {
        issues.push({ ...at, code: 'self_reference', message: `A rule on ${name(target)} refers to itself. Pick a question above it.` })
        return
      }
      if (entry.index > ti) {
        issues.push({ ...at, code: 'later_source', message: `A rule on ${name(target)} uses ${name(src)}, which is below it. Move ${name(src)} above it or change the rule.` })
        return
      }
      const core = coreRegistry[src.type]
      if (!core.stores) {
        issues.push({ ...at, code: 'invalid_source', message: `A rule on ${name(target)} uses a section break, which has no answer. Pick a question instead.` })
        return
      }
      if (!core.operators.includes(c.op)) {
        issues.push({ ...at, code: 'bad_operator', message: `A rule on ${name(target)} uses a comparison that doesn't fit ${name(src)}. Choose another comparison.` })
        return
      }
      if (VALUELESS_OPS.includes(c.op)) return
      const v = c.value
      if (v === undefined || (typeof v === 'string' && v.trim() === '')) {
        issues.push({ ...at, code: 'missing_value', message: `A rule on ${name(target)} has no value to compare with. Fill it in.` })
        return
      }
      const bad = (what: string) =>
        issues.push({ ...at, code: 'bad_value', message: `A rule on ${name(target)} compares ${name(src)} with "${String(v)}", which is not ${what}. Fix the value.` })
      switch (src.type) {
        case 'number':
        case 'rating':
        case 'nps':
          if (typeof v === 'boolean' || !Number.isFinite(Number(v))) bad('a number')
          break
        case 'date':
          if (!isIsoDate(v)) bad('a date')
          break
        case 'time':
          if (!isTime(v)) bad('a time')
          break
        case 'single_choice':
        case 'multiple_choice':
        case 'dropdown':
        case 'picture_choice': {
          const props = src.props as { options: { id: string }[]; other?: boolean }
          const ok = props.options.some((o) => o.id === v) || (props.other === true && v === OTHER_OPTION_ID)
          if (!ok) {
            issues.push({ ...at, code: 'unknown_option', message: `A rule on ${name(target)} uses an option of ${name(src)} that was deleted. Pick an option again.` })
          }
          break
        }
        default:
          break
      }
    })
    for (const text of [target.label, target.description ?? '']) {
      for (const p of parsePipes(text)) {
        const entry = idx.get(p.fieldId)
        if (!entry) {
          issues.push({ code: 'pipe_missing', fieldId: target.id, source: p.fieldId, message: `${name(target)} shows an answer from a question that was deleted. Remove that answer from the text.` })
        } else if (entry.index >= ti) {
          issues.push({ code: 'pipe_later', fieldId: target.id, source: p.fieldId, message: `${name(target)} shows the answer to ${name(entry.field)}, which comes later. Only earlier answers can be shown.` })
        }
      }
    }
  })
  const screens: [string, string[]][] = [
    ['startScreen', [def.startScreen.title, def.startScreen.description ?? '']],
    ['endScreen', [def.endScreen.title, def.endScreen.message]],
  ]
  for (const [where, texts] of screens) {
    for (const text of texts) {
      for (const p of parsePipes(text)) {
        if (!idx.has(p.fieldId)) {
          const label = where === 'startScreen' ? 'The start screen' : 'The end screen'
          issues.push({ code: 'pipe_missing', fieldId: where, source: p.fieldId, message: `${label} shows an answer from a question that was deleted. Remove it from the text.` })
        }
      }
    }
  }
  return issues
}

export interface Dependent {
  /** The field whose rule or text depends on the source; "startScreen" / "endScreen" for screens. */
  fieldId: string
  via: 'logic' | 'pipe'
  conditionIndex?: number
}

/** Who breaks if `fieldId` is deleted (the builder warns first and lists these). */
export function dependentsOf(def: FormDefinition, fieldId: string): Dependent[] {
  const out: Dependent[] = []
  for (const f of def.fields) {
    if (f.id === fieldId) continue
    f.logic?.conditions.forEach((c, i) => {
      if (c.field === fieldId) out.push({ fieldId: f.id, via: 'logic', conditionIndex: i })
    })
    if ([f.label, f.description ?? ''].some((t) => parsePipes(t).some((p) => p.fieldId === fieldId))) {
      out.push({ fieldId: f.id, via: 'pipe' })
    }
  }
  const s = def.startScreen
  if ([s.title, s.description ?? ''].some((t) => parsePipes(t).some((p) => p.fieldId === fieldId))) {
    out.push({ fieldId: 'startScreen', via: 'pipe' })
  }
  const e = def.endScreen
  if ([e.title, e.message].some((t) => parsePipes(t).some((p) => p.fieldId === fieldId))) {
    out.push({ fieldId: 'endScreen', via: 'pipe' })
  }
  return out
}

/** Rules whose source sits at or below their target (after a reorder). One entry per pair. */
export function orderViolations(def: Def): { target: string; source: string }[] {
  const idx = indexOf(def)
  const out: { target: string; source: string }[] = []
  const seen = new Set<string>()
  def.fields.forEach((target, ti) => {
    for (const c of target.logic?.conditions ?? []) {
      const s = idx.get(c.field)
      const key = `${target.id}>${c.field}`
      if (s && s.index >= ti && !seen.has(key)) {
        seen.add(key)
        out.push({ target: target.id, source: c.field })
      }
    }
  })
  return out
}

// ---------------------------------------------------------------------------------------
// Piping

/**
 * `{f_x}`, `{f_x.first}`, `{f_x.first|there}`: field id, optional part, optional fallback
 * shown when the answer is empty. Global: use with String.replace / matchAll only.
 */
export const PIPE_RE = /\{(f_[a-z0-9]{4,12})(?:\.([a-z][a-z0-9]*))?(?:\|([^{}]*))?\}/g

export interface PipeToken {
  raw: string
  fieldId: string
  part?: string
  fallback?: string
  index: number
}

export function parsePipes(text: string): PipeToken[] {
  if (!text || !text.includes('{')) return []
  return [...text.matchAll(PIPE_RE)].map((m) => ({
    raw: m[0],
    fieldId: m[1],
    ...(m[2] !== undefined && { part: m[2] }),
    ...(m[3] !== undefined && { fallback: m[3] }),
    index: m.index,
  }))
}

/** Build a token for the builder: pipeToken("f_8k2m", "first", "there") → "{f_8k2m.first|there}". */
export function pipeToken(fieldId: string, part?: string, fallback?: string): string {
  const clean = fallback?.replace(/[{}]/g, '')
  return `{${fieldId}${part ? `.${part}` : ''}${clean ? `|${clean}` : ''}}`
}

/**
 * Replace pipe tokens with answers. Pass pruned answers (hidden fields must not leak).
 * An empty or missing answer renders as the fallback, or nothing. The output is plain text:
 * render it as text, never as HTML.
 */
export function interpolate(text: string, def: Def, answers: Answers): string {
  if (!text || !text.includes('{')) return text
  const idx = indexOf(def)
  return text.replace(PIPE_RE, (_m, id: string, part: string | undefined, fallback: string | undefined) => {
    const f = idx.get(id)?.field
    const fb = fallback ?? ''
    if (!f) return fb
    const core = coreRegistry[f.type]
    const v = answers[id]
    if (core.isEmpty(v)) return fb
    try {
      const out = core.pipe(v, part, f)
      return out.trim() === '' ? fb : out
    } catch {
      return fb
    }
  })
}
