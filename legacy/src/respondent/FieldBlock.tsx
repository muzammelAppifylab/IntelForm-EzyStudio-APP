import { useRef } from 'react'
import type { FormField } from '@shared/form/definition'
import { FieldError } from '@/components/ds/FieldError'
import { clsx } from 'clsx'
import { FIELD_RENDERERS } from '@/form-types/renderers'
import type { Engine, TtcClock } from './engine'
import { AUTO_ADVANCE_TYPES, isGroupField, type ChangeMeta } from './types'

/**
 * One question: heading (a focus target, `tabindex=-1`), description, the type's renderer and
 * its error. Input types get a <label> inside the heading; group types put the heading in
 * their fieldset legend.
 */
export interface FieldBlockProps {
  field: FormField
  engine: Engine
  ttc: TtcClock
  preview: boolean
  /** One-at-a-time: big type, question number, Enter/OK advances. */
  large?: boolean
  number?: number
  level?: 2 | 3
  onAdvance?: () => void
  /** One-at-a-time: a pointer pick on a single-choice-like field (auto-advance after 300 ms). */
  onPointerPick?: () => void
  onAnswered?: () => void
}

export const fieldDomId = (id: string) => `q-${id}`

export function FieldBlock({ field, engine, ttc, preview, large = false, number, level = 2, onAdvance, onPointerPick, onAnswered }: FieldBlockProps) {
  const Renderer = FIELD_RENDERERS[field.type]
  const lastPointer = useRef(0)
  const group = isGroupField(field)
  const inputId = `if-${field.id}`
  const descId = `${inputId}-desc`
  const errId = `${inputId}-err`
  const error = engine.errors[field.id]
  const label = engine.pipe(field.label).trim() || engine.labels.untitledQuestion
  const description = engine.pipe(field.description).trim() || undefined
  const autoAdvance = !!onPointerPick && AUTO_ADVANCE_TYPES.has(field.type)
  const H = level === 3 ? 'h3' : 'h2'

  const onChange = (value: unknown, meta?: ChangeMeta) => {
    engine.setAnswer(field.id, value, meta)
    if (meta?.silent) return
    onAnswered?.()
    if (autoAdvance && value !== undefined && Date.now() - lastPointer.current < 1500) onPointerPick?.()
  }

  const numberBadge = number !== undefined && (
    <span aria-hidden className="mr-2 inline-flex translate-y-[-0.1em] items-center text-label font-medium text-[color:var(--form-answer,var(--primary))] tabular-nums">
      {number}
      <span className="ml-0.5">→</span>
    </span>
  )

  const heading = (
    <H
      tabIndex={-1}
      data-step-heading
      className={clsx(
        'outline-none',
        group ? clsx('inline', large && 'text-question-xl') : large ? 'text-question-xl text-foreground' : 'text-question text-foreground',
        field.hideLabel && 'sr-only',
      )}
    >
      {numberBadge}
      {group ? (
        label
      ) : (
        <label htmlFor={inputId} className="cursor-default">
          {label}
        </label>
      )}
      {!group && field.required && (
        <span aria-hidden className="text-destructive">
          {' '}*
        </span>
      )}
      {autoAdvance && <span className="sr-only">. {engine.labels.autoAdvanceHint}</span>}
    </H>
  )

  return (
    <div
      id={fieldDomId(field.id)}
      data-field={field.id}
      className="grid min-w-0 gap-3 scroll-mt-6"
      onPointerDownCapture={() => (lastPointer.current = Date.now())}
      onKeyDownCapture={() => (lastPointer.current = 0)}
      onFocus={() => ttc.enter(field.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) ttc.leave()
      }}
    >
      {!group && heading}
      {!group && description && (
        <p id={descId} className="-mt-1 text-body text-muted-foreground whitespace-pre-line">
          {description}
        </p>
      )}
      <Renderer
        field={field}
        value={engine.answers[field.id]}
        onChange={onChange}
        labels={engine.labels}
        inputId={inputId}
        describedBy={[!group && description ? descId : null, !group && error ? errId : null].filter(Boolean).join(' ') || undefined}
        invalid={!!error}
        error={group ? error : undefined}
        legend={heading}
        description={group ? description : undefined}
        large={large}
        onAdvance={onAdvance}
        preview={preview}
      />
      {!group && error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  )
}

/** Focus a field's first control (the error summary links and "focus the first invalid field"). */
export function focusField(root: HTMLElement | null, id: string, smooth = true): void {
  const block = root?.querySelector<HTMLElement>(`[data-field="${id}"]`)
  if (!block) return
  const target =
    block.querySelector<HTMLElement>('input[type=radio]:checked, input[type=checkbox]:checked') ??
    block.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), textarea, select, button:not(:disabled)')
  ;(target ?? block.querySelector<HTMLElement>('[data-step-heading]'))?.focus({ preventScroll: true })
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  block.scrollIntoView({ block: 'center', behavior: smooth && !reduced ? 'smooth' : 'auto' })
}
