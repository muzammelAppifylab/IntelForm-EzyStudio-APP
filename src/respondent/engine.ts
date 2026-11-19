import { useCallback, useMemo, useRef, useState } from 'react'
import type { FormDefinition, FormField } from '../lib/intelform/form/definition'
import { SYSTEM_LABELS, errorMessage, type Labels } from '../lib/intelform/form/labels'
import { computeVisibility, interpolate, interpolateHtml, pruneAnswers, validateField, type Answers } from '../lib/intelform/form/logic'
import { descriptionToHtml, isBlankHtml, sanitizeRichText } from '../lib/intelform/form/rich-text'
import type { ChangeMeta } from './types'

/**
 * Respondent form state: answers in memory only (PRD: a refresh loses them), live visibility,
 * pruned answers for piping, and validation that matches the server's (validateField from the
 * shared core, plus the renderers' own "can't parse this yet" codes).
 */
export interface Engine {
  def: FormDefinition
  labels: Labels
  answers: Answers
  /** Answers to visible fields only: use for piping and submit. */
  pruned: Answers
  visible: Set<string>
  pages: string[][]
  pageSections: (string | null)[]
  errors: Record<string, string>
  field: (id: string) => FormField | undefined
  setAnswer: (id: string, value: unknown, meta?: ChangeMeta) => void
  /** Errors for these field ids (visible ones only). */
  check: (ids: readonly string[]) => Record<string, string>
  /** Show these errors (replaces the shown set for the given ids, or all when ids is omitted). */
  showErrors: (errors: Record<string, string>, ids?: readonly string[]) => void
  pipe: (text: string | undefined) => string
  /**
   * A field's description (rich or plain) with answers piped in, as sanitized HTML for
   * <RichText>; '' when it shows no text.
   */
  description: (field: Pick<FormField, 'description' | 'descriptionFormat'> | undefined) => string
}

const CONTEXT = { dayTolerance: 0 }

/**
 * The error to show for one field, or undefined: a renderer's own "can't parse this yet" code
 * (`invalid`) wins, else the shared validator (the same rules the server runs on submit).
 */
export function fieldError(f: FormField, answers: Answers, invalid: Readonly<Record<string, string>>, labels: Labels = SYSTEM_LABELS): string | undefined {
  const local = invalid[f.id]
  if (local) return errorMessage(local, labels)
  const r = validateField(f, answers[f.id], labels, CONTEXT)
  return r.ok ? undefined : r.error
}

/** Errors for these field ids, skipping fields hidden by logic (they are not submitted). */
export function checkFields(
  def: FormDefinition,
  answers: Answers,
  ids: readonly string[],
  invalid: Readonly<Record<string, string>> = {},
  labels: Labels = SYSTEM_LABELS,
): Record<string, string> {
  const byId = new Map(def.fields.map((f) => [f.id, f]))
  const visible = computeVisibility(def, answers).fields
  const out: Record<string, string> = {}
  for (const id of ids) {
    const f = byId.get(id)
    if (!f || !visible.has(id)) continue
    const e = fieldError(f, answers, invalid, labels)
    if (e) out[id] = e
  }
  return out
}

/** Shown errors after a new set for `ids` (or a full replacement when `ids` is omitted). */
export function mergeErrors(shown: Readonly<Record<string, string>>, next: Record<string, string>, ids?: readonly string[]): Record<string, string> {
  const merged: Record<string, string> = ids ? { ...shown } : {}
  if (ids) for (const id of ids) delete merged[id]
  return Object.assign(merged, next)
}

/** `initialAnswers`: answers to start from (read on mount only), e.g. kept across a reload of a republished form. */
export function useFormEngine(def: FormDefinition, initialAnswers?: Answers | null): Engine {
  const labels = SYSTEM_LABELS
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers ?? {})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const answersRef = useRef<Answers>(initialAnswers ?? {})
  const invalidRef = useRef<Record<string, string>>({})
  const errorsRef = useRef<Record<string, string>>({})

  const byId = useMemo(() => new Map(def.fields.map((f) => [f.id, f])), [def.fields])
  const vis = useMemo(() => computeVisibility(def, answers), [def, answers])
  const pruned = useMemo(() => pruneAnswers(def, answers), [def, answers])

  const errorFor = useCallback(
    (f: FormField, ans: Answers): string | undefined => fieldError(f, ans, invalidRef.current, labels),
    [labels],
  )

  const check = useCallback(
    (ids: readonly string[]) => checkFields(def, answersRef.current, ids, invalidRef.current, labels),
    [def, labels],
  )

  const showErrors = useCallback((next: Record<string, string>, ids?: readonly string[]) => {
    const merged = mergeErrors(errorsRef.current, next, ids)
    errorsRef.current = merged
    setErrors(merged)
  }, [])

  const setAnswer = useCallback(
    (id: string, value: unknown, meta?: ChangeMeta) => {
      const next = { ...answersRef.current }
      if (value === undefined) delete next[id]
      else next[id] = value
      answersRef.current = next
      if (meta && meta.invalid !== undefined) {
        const inv = { ...invalidRef.current }
        if (meta.invalid) inv[id] = meta.invalid
        else delete inv[id]
        invalidRef.current = inv
      }
      setAnswers(next)
      // After a failed attempt, errors clear (or update) as the respondent fixes them.
      if (errorsRef.current[id] !== undefined) {
        const f = byId.get(id)
        const e = f ? errorFor(f, next) : undefined
        const merged = { ...errorsRef.current }
        if (e) merged[id] = e
        else delete merged[id]
        errorsRef.current = merged
        setErrors(merged)
      }
    },
    [byId, errorFor],
  )

  const pipe = useCallback((text: string | undefined) => (text ? interpolate(text, def, pruned) : ''), [def, pruned])
  const description = useCallback(
    (f: Pick<FormField, 'description' | 'descriptionFormat'> | undefined) => {
      const html = descriptionToHtml(f?.description, f?.descriptionFormat)
      if (!html) return ''
      const clean = sanitizeRichText(interpolateHtml(html, def, pruned))
      return isBlankHtml(clean) ? '' : clean
    },
    [def, pruned],
  )

  return {
    def,
    labels,
    answers,
    pruned,
    visible: vis.fields,
    pages: vis.pages,
    pageSections: vis.pageSections,
    errors,
    field: (id) => byId.get(id),
    setAnswer,
    check,
    showErrors,
    pipe,
    description,
  }
}

/** Time to complete per field, from focus (or step) enter to leave. */
export class TtcClock {
  private totals: Record<string, number> = {}
  private current: { id: string; at: number } | null = null

  enter(id: string): void {
    if (this.current?.id === id) return
    this.leave()
    this.current = { id, at: performance.now() }
  }

  leave(): void {
    if (!this.current) return
    const { id, at } = this.current
    this.totals[id] = (this.totals[id] ?? 0) + Math.round(performance.now() - at)
    this.current = null
  }

  snapshot(): Record<string, number> {
    const out = { ...this.totals }
    if (this.current) out[this.current.id] = (out[this.current.id] ?? 0) + Math.round(performance.now() - this.current.at)
    return out
  }
}
