import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import { FieldBlock, fieldDomId, focusField } from '../FieldBlock'
import { FormButton } from '../ui'
import type { LayoutContext } from './context'
import { SubmitError } from './FormError'

/**
 * Every field on one page; section breaks are dividers with their title. Submit validates all
 * of it and shows an error summary at the top (GOV.UK pattern): focus moves to the summary,
 * whose links jump to each field, and the page title gets an "Error:" prefix.
 */
export function AllAtOnce({ ctx }: { ctx: LayoutContext }) {
  const { engine, ttc, preview } = ctx
  const { labels, def } = engine
  const rootRef = useRef<HTMLFormElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const ids = engine.pages.flat()
  const shown = ids.filter((id) => engine.errors[id])
  const hasSections = def.fields.some((f) => f.type === 'section_break' && engine.visible.has(f.id))

  useEffect(() => {
    if (attempt === 0) return
    summaryRef.current?.focus({ preventScroll: true })
    summaryRef.current?.scrollIntoView({ block: 'start' })
  }, [attempt])

  useEffect(() => {
    ctx.announce(null, { error: attempt > 0 && shown.length > 0 })
    // Title follows whether errors are showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt > 0 && shown.length > 0])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (ctx.submitting) return
    const errs = engine.check(ids)
    engine.showErrors(errs)
    if (Object.keys(errs).length) return setAttempt((a) => a + 1)
    const r = await ctx.submit()
    if (!r.ok && Object.keys(r.errors).length) setAttempt((a) => a + 1)
  }

  return (
    <form ref={rootRef} noValidate onSubmit={onSubmit} className="flex flex-1 flex-col px-4 py-10 @lg:px-8 @lg:py-14">
      <div className="mx-auto grid w-full max-w-(--form-width) gap-6">
        {ctx.title && <h1 className={clsx(ctx.hideTitle ? 'sr-only' : 'text-question-xl text-foreground')}>{ctx.title}</h1>}
        {attempt > 0 && shown.length > 0 && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            aria-labelledby="if-error-summary"
            className="grid gap-3 rounded-lg border-2 border-destructive bg-danger-subtle p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <h2 id="if-error-summary" className="flex items-center gap-2 text-question text-danger-subtle-foreground">
              <CircleAlert aria-hidden className="size-5 shrink-0" />
              {labels.errorSummary}
            </h2>
            <ul className="grid gap-1.5 pl-7">
              {shown.map((id) => (
                <li key={id}>
                  <a
                    href={`#${fieldDomId(id)}`}
                    onClick={(e) => {
                      e.preventDefault()
                      focusField(rootRef.current, id)
                    }}
                    className="text-body text-danger-subtle-foreground underline underline-offset-4"
                  >
                    {engine.pipe(engine.field(id)?.label).trim() || labels.untitledQuestion} – {engine.errors[id]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {def.fields.map((f) => {
          if (!engine.visible.has(f.id)) return null
          if (f.type === 'section_break') {
            const title = engine.pipe(f.label).trim()
            const desc = engine.pipe(f.description).trim()
            if (!title && !desc) return <hr key={f.id} className="border-border" />
            return (
              <div key={f.id} className="mt-4 grid gap-1.5 border-t border-border pt-8">
                {title && <h2 className={clsx('text-question-xl text-foreground', f.hideLabel && 'sr-only')}>{title}</h2>}
                {desc && <p className="text-answer text-muted-foreground whitespace-pre-line">{desc}</p>}
              </div>
            )
          }
          return <FieldBlock key={f.id} field={f} engine={engine} ttc={ttc} preview={preview} level={hasSections ? 3 : 2} onAnswered={ctx.markStarted} />
        })}
        <SubmitError message={ctx.formError} action={ctx.formErrorAction} />
        <div>
          <FormButton type="submit" disabled={ctx.submitting}>
            {ctx.submitting ? labels.submitting : labels.submit}
          </FormButton>
        </div>
      </div>
    </form>
  )
}
