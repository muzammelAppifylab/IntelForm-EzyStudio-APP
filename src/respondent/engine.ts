import { useCallback, useMemo, useRef, useState } from 'react'
import type { FormDefinition, FormField } from '@shared/form/definition'
import { errorMessage, resolveLabels, type Labels } from '@shared/form/labels'
import { computeVisibility, interpolate, pruneAnswers, validateField, type Answers } from '@shared/form/logic'
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
}

const CONTEXT = { dayTolerance: 0 }

/** `initialAnswers`: answers to start from (read on mount only), e.g. kept across a reload of a republished form. */
export function useFormEngine(def: FormDefinition, labelOverrides?: Record<string, string>, initialAnswers?: Answers | null): Engine {
  const labels = useMemo(() => resolveLabels({ ...def.labels, ...labelOverrides }), [def.labels, labelOverrides])
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers ?? {})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const answersRef = useRef<Answers>(initialAnswers ?? {})
  const invalidRef = useRef<Record<string, string>>({})
  const errorsRef = useRef<Record<string, string>>({})

  const byId = useMemo(() => new Map(def.fields.map((f) => [f.id, f])), [def.fields])
  const vis = useMemo(() => computeVisibility(def, answers), [def, answers])
  const pruned = useMemo(() => pruneAnswers(def, answers), [def, answers])

  const errorFor = useCallback(
    (f: FormField, ans: Answers): string | undefined => {
      const local = invalidRef.current[f.id]
      if (local) return errorMessage(local, labels)
      const r = validateField(f, ans[f.id], labels, CONTEXT)
      return r.ok ? undefined : r.error
    },
    [labels],
  )

  const check = useCallback(
    (ids: readonly string[]) => {
      const ans = answersRef.current
      const visible = computeVisibility(def, ans).fields
      const out: Record<string, string> = {}
      for (const id of ids) {
        const f = byId.get(id)
        if (!f || !visible.has(id)) continue
        const e = errorFor(f, ans)
        if (e) out[id] = e
      }
      return out
    },
    [byId, def, errorFor],
  )

  const showErrors = useCallback((next: Record<string, string>, ids?: readonly string[]) => {
    const merged = ids ? { ...errorsRef.current } : {}
    if (ids) for (const id of ids) delete merged[id]
    Object.assign(merged, next)
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
