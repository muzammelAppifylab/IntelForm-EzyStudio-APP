import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { formatLabel } from '@shared/form/labels'
import type { FieldType } from '@shared/form/field-types'
import { ProgressBar } from '@/components/ds/ProgressBar'
import { clsx } from 'clsx'
import { FieldBlock, focusField } from '../FieldBlock'
import { iconButtonClass } from '../classes'
import { FormButton } from '../ui'
import { focusStep, type LayoutContext } from './context'
import { SubmitError } from './FormError'

/** Single-line types where Enter advances (the "press Enter" hint shows on desktop). */
const ENTER_TYPES: ReadonlySet<FieldType> = new Set(['email', 'name', 'phone', 'short_text', 'number', 'url', 'date', 'country', 'dropdown'])
const AUTO_ADVANCE_MS = 300
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * One question per screen: large type, question number, OK / Enter to advance, up/down buttons
 * in the corner, progress, a 320 ms slide between steps (instant under reduced motion).
 */
export function OneAtATime({ ctx, fixedNav }: { ctx: LayoutContext; fixedNav: boolean }) {
  const { engine, ttc, preview } = ctx
  const { labels } = engine
  const steps = useMemo(() => engine.pages.flat(), [engine.pages])
  const [current, setCurrent] = useState<string | undefined>(steps[0])
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  const idx = Math.max(0, current ? steps.indexOf(current) : 0)
  const id = steps[idx]
  const field = id ? engine.field(id) : undefined
  const isLast = idx === steps.length - 1
  const stepRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const moved = useRef(false)
  const pendingError = useRef<string | null>(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!id) return
    ttc.enter(id)
    ctx.announce(steps.length > 1 ? formatLabel(labels.question, { n: idx + 1, total: steps.length }) : null)
    if (pendingError.current === id) {
      pendingError.current = null
      focusField(stepRef.current, id, false)
    } else if (moved.current || ctx.allowFocus()) {
      focusStep(stepRef.current, ctx.focusInputs)
    }
    // Announce and focus once per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const go = (to: number, d: 'fwd' | 'back') => {
    window.clearTimeout(timer.current)
    moved.current = true
    setDir(d)
    setCurrent(steps[to])
  }

  const next = async () => {
    window.clearTimeout(timer.current)
    if (!id || ctx.submitting) return
    const errs = engine.check([id])
    engine.showErrors(errs, [id])
    if (errs[id]) {
      focusField(stepRef.current, id, false)
      return
    }
    if (!isLast) {
      ctx.playStep()
      return go(idx + 1, 'fwd')
    }
    const r = await ctx.submit()
    if (!r.ok) {
      const first = steps.find((s) => r.errors[s])
      if (first && first !== id) {
        pendingError.current = first
        go(steps.indexOf(first), 'back')
      } else if (first) focusField(stepRef.current, first, false)
    }
  }
  const nextRef = useRef(next)
  nextRef.current = next

  const back = () => {
    if (idx > 0) go(idx - 1, 'back')
  }

  const pageIndex = id ? engine.pages.findIndex((p) => p.includes(id)) : -1
  const sectionId = pageIndex >= 0 && engine.pages[pageIndex][0] === id ? engine.pageSections[pageIndex] : null
  const section = sectionId ? engine.pipe(engine.field(sectionId)?.label).trim() : ''

  if (!field) {
    return <div className="flex flex-1 items-center justify-center p-8 text-body text-muted-foreground">{ctx.title ?? ''}</div>
  }

  const hint = ctx.focusInputs
    ? field.type === 'long_text'
      ? formatLabel(labels.longTextEnter, { key: IS_MAC ? '⌘' : 'Ctrl' })
      : ENTER_TYPES.has(field.type) && !(field.type === 'name' && field.props.split)
        ? labels.pressEnter
        : null
    : null

  return (
    <div className="relative flex flex-1 flex-col">
      {ctx.title && <h1 className="sr-only">{ctx.title}</h1>}
      {steps.length > 1 && (
        <div className="px-4 pt-5 @lg:px-8">
          <ProgressBar
            className="mx-auto w-full max-w-(--question-width)"
            current={idx + 1}
            total={steps.length}
            label={formatLabel(labels.question, { n: idx + 1, total: steps.length })}
          />
        </div>
      )}
      <div className="flex flex-1 items-center px-4 pt-10 pb-24 @lg:px-8">
        <div
          ref={stepRef}
          key={id}
          className={clsx(
            'mx-auto grid w-full max-w-(--question-width) gap-8',
            dir === 'fwd' ? 'if-step-fwd' : 'if-step-back',
            ctx.center && 'text-center [&_[data-slot=choice-option]]:text-left [&_legend]:w-full',
          )}
        >
          {section && <p className="text-overline text-muted-foreground">{section}</p>}
          <FieldBlock
            field={field}
            engine={engine}
            ttc={ttc}
            preview={preview}
            large
            number={idx + 1}
            onAdvance={() => void nextRef.current()}
            onPointerPick={
              isLast
                ? undefined
                : () => {
                    window.clearTimeout(timer.current)
                    timer.current = window.setTimeout(() => void nextRef.current(), AUTO_ADVANCE_MS)
                  }
            }
            onAnswered={ctx.markStarted}
          />
          <SubmitError message={ctx.formError} action={ctx.formErrorAction} />
          <div className={clsx('flex flex-wrap items-center gap-4', ctx.center && 'justify-center')}>
            <FormButton type="button" onClick={() => void next()} disabled={ctx.submitting} aria-describedby={undefined}>
              {isLast ? (ctx.submitting ? labels.submitting : labels.submit) : labels.ok}
              {!isLast && <Check aria-hidden />}
            </FormButton>
            {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
          </div>
        </div>
      </div>
      {steps.length > 1 && (
        <nav
          aria-label={labels.questionNavigation}
          className={clsx(fixedNav ? 'fixed' : 'absolute', 'right-4 z-(--z-sticky) flex gap-1 @lg:right-8')}
          style={{ bottom: 'calc(1rem + var(--kb, 0px))' }}
        >
          <button type="button" data-slot="button" data-variant="outline" data-size="icon-lg" aria-label={labels.previousQuestion} disabled={idx === 0} onClick={back} className={iconButtonClass}>
            <ChevronUp aria-hidden />
          </button>
          <button type="button" data-slot="button" data-variant="outline" data-size="icon-lg" aria-label={labels.nextQuestion} disabled={isLast || ctx.submitting} onClick={() => void next()} className={iconButtonClass}>
            <ChevronDown aria-hidden />
          </button>
        </nav>
      )}
    </div>
  )
}
