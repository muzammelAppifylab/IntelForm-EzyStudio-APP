import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { formatLabel } from '@shared/form/labels'
import { ProgressBar } from '@/components/ds/ProgressBar'
import { FieldBlock, focusField } from '../FieldBlock'
import { FormButton } from '../ui'
import { focusStep, type LayoutContext } from './context'
import { SubmitError } from './FormError'

/**
 * Section by section: one page per section break, its title and description on top, progress
 * "Step 2 of 4", Back / Next / Submit. Next validates the page and focuses the first invalid field.
 */
export function Paged({ ctx }: { ctx: LayoutContext }) {
  const { engine, ttc, preview } = ctx
  const { labels, pages } = engine
  const [page, setPage] = useState(0)
  const p = Math.min(page, Math.max(0, pages.length - 1))
  const ids = pages[p] ?? []
  const isLast = p >= pages.length - 1
  const sectionId = engine.pageSections[p]
  const section = sectionId ? engine.field(sectionId) : undefined
  const pageRef = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const pendingError = useRef<string | null>(null)

  useEffect(() => {
    ctx.announce(pages.length > 1 ? formatLabel(labels.step, { n: p + 1, total: pages.length }) : null)
    if (!moved.current) return
    ctx.scrollTop()
    if (pendingError.current) {
      focusField(pageRef.current, pendingError.current, false)
      pendingError.current = null
    } else focusStep(pageRef.current, false)
    // Once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p])

  const goTo = (to: number) => {
    moved.current = true
    setPage(to)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (ctx.submitting) return
    const errs = engine.check(ids)
    engine.showErrors(errs, ids)
    const first = ids.find((id) => errs[id])
    if (first) return focusField(pageRef.current, first)
    if (!isLast) return goTo(p + 1)
    const r = await ctx.submit()
    if (r.ok) return
    const errorId = pages.flat().find((id) => r.errors[id])
    if (!errorId) return
    const at = pages.findIndex((pg) => pg.includes(errorId))
    if (at === p) focusField(pageRef.current, errorId)
    else {
      pendingError.current = errorId
      goTo(at)
    }
  }

  const sectionTitle = section ? engine.pipe(section.label).trim() : ''
  const sectionDesc = section ? engine.pipe(section.description).trim() : ''

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-1 flex-col px-4 py-10 @lg:px-8 @lg:py-14">
      <div className="mx-auto grid w-full max-w-(--form-width) gap-8">
        {ctx.title && <h1 className="sr-only">{ctx.title}</h1>}
        {pages.length > 1 && <ProgressBar current={p + 1} total={pages.length} label={formatLabel(labels.step, { n: p + 1, total: pages.length })} />}
        <div ref={pageRef} className="grid gap-6">
          {(sectionTitle || sectionDesc) && (
            <header className="grid gap-2">
              {sectionTitle && (
                <h2 tabIndex={-1} data-step-heading className="text-question-xl text-foreground outline-none">
                  {sectionTitle}
                </h2>
              )}
              {sectionDesc && <p className="text-answer text-muted-foreground whitespace-pre-line">{sectionDesc}</p>}
            </header>
          )}
          {ids.map((id) => {
            const f = engine.field(id)
            return f ? (
              <FieldBlock key={id} field={f} engine={engine} ttc={ttc} preview={preview} level={sectionTitle ? 3 : 2} onAnswered={ctx.markStarted} />
            ) : null
          })}
        </div>
        <SubmitError message={ctx.formError} action={ctx.formErrorAction} />
        <div className="flex items-center justify-between gap-3">
          {p > 0 ? (
            <FormButton type="button" variant="outline" onClick={() => goTo(p - 1)}>
              <ArrowLeft aria-hidden />
              {labels.back}
            </FormButton>
          ) : (
            <span />
          )}
          <FormButton type="submit" disabled={ctx.submitting}>
            {isLast ? (ctx.submitting ? labels.submitting : labels.submit) : labels.next}
            {!isLast && <ArrowRight aria-hidden />}
          </FormButton>
        </div>
      </div>
    </form>
  )
}
