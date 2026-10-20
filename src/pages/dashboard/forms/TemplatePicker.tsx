import { useQuery } from '@tanstack/react-query'
import { FilePlus2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { TemplateSummary } from '@shared/api-forms'
import { LAYOUT_LABEL } from '@shared/form/definition'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayoutIcon } from './bits'
import { groupByCategory } from './format'
import { templatesQuery } from './queries'

/** One template as a card. `action` is the footer (Use template, menus…). */
export function TemplateCard({
  template,
  onUse,
  busy,
  disabled,
  menu,
  className,
}: {
  template: TemplateSummary
  onUse?: () => void
  busy?: boolean
  disabled?: boolean
  menu?: ReactNode
  className?: string
}) {
  const questions = `${template.fieldCount} ${template.fieldCount === 1 ? 'question' : 'questions'}`
  return (
    <article className={cn('flex flex-col gap-3 rounded-lg border bg-card p-4', className)}>
      <div className="flex items-start gap-3">
        <LayoutIcon layout={template.layout} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="truncate text-label text-foreground">{template.name}</h3>
          <p className="text-caption text-muted-foreground">
            {questions} · {LAYOUT_LABEL[template.layout] ?? 'All at once'}
          </p>
        </div>
        {menu}
      </div>
      {template.description && <p className="line-clamp-2 text-body-sm text-muted-foreground">{template.description}</p>}
      {onUse && (
        <div className="mt-auto pt-1">
          <Button variant="outline" size="sm" onClick={onUse} disabled={disabled || busy} aria-label={`Use template: ${template.name}`}>
            {busy && <Spinner />}
            {busy ? 'Creating…' : 'Use template'}
          </Button>
        </div>
      )}
    </article>
  )
}

/** Every template by category, plus a "Start blank" tile. Used by the New form dialog. */
export function TemplatePicker({
  onBlank,
  onTemplate,
  pendingId,
}: {
  onBlank: () => void
  onTemplate: (t: TemplateSummary) => void
  /** 'blank' or a template id while that one is being created. */
  pendingId: string | null
}) {
  const templates = useQuery(templatesQuery)
  const busy = pendingId !== null

  return (
    <div className="grid gap-6">
      <button
        type="button"
        onClick={onBlank}
        disabled={busy}
        className="focus-ring flex items-center gap-4 rounded-lg border border-dashed border-input bg-card p-4 text-left transition-colors hover:bg-accent disabled:opacity-50"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
          {pendingId === 'blank' ? <Spinner className="size-5" /> : <FilePlus2 className="size-5" aria-hidden />}
        </span>
        <span className="grid gap-0.5">
          <span className="text-label">{pendingId === 'blank' ? 'Creating…' : 'Start blank'}</span>
          <span className="text-caption text-muted-foreground">An empty form with the default theme</span>
        </span>
      </button>

      {templates.isPending && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      )}
      {templates.isError && (
        <p className="text-body-sm text-muted-foreground">
          Templates didn’t load. {errorMessage(templates.error)}{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => templates.refetch()}>Try again</Button>
        </p>
      )}
      {templates.data &&
        groupByCategory(templates.data.templates, templates.data.categories).map((g) => (
          <section key={g.category} className="grid gap-3" aria-label={g.category}>
            <h3 className="text-overline text-muted-foreground uppercase">{g.category}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {g.items.map((t) => (
                <TemplateCard key={t.id} template={t} onUse={() => onTemplate(t)} busy={pendingId === t.id} disabled={busy} />
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}
