import { useQuery } from '@tanstack/react-query'
import { FilePlus2, FileText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { useCan } from '@/lib/auth'
import { templatesQuery, useCreateForm } from './queries'
import { TemplateCard } from './TemplatePicker'

/** The three templates suggested to a team with no forms yet. */
const SUGGESTED = ['builtin-lead-capture', 'builtin-contact-support', 'builtin-nps']

/** First run: a short welcome, three suggested templates and "Start blank". */
export function EmptyForms() {
  const canEdit = useCan('forms.edit')
  const templates = useQuery({ ...templatesQuery, enabled: canEdit })
  const create = useCreateForm()
  const [pending, setPending] = useState<string | null>(null)

  if (!canEdit) {
    return (
      <section className="grid justify-items-center gap-3 rounded-lg border bg-card px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-foreground">
          <FileText className="size-6" aria-hidden />
        </span>
        <h2 className="text-subheading">No forms yet</h2>
        <p className="max-w-sm text-body text-muted-foreground">Forms your team creates show up here, with their responses.</p>
      </section>
    )
  }

  const suggested = SUGGESTED.map((slug) => templates.data?.templates.find((t) => t.slug === slug)).filter((t) => !!t)
  const start = (id: string, templateId?: string) => {
    setPending(id)
    create.mutate({ templateId }, { onError: () => setPending(null) })
  }

  return (
    <section className="grid gap-8 rounded-lg border bg-card px-6 py-10 sm:px-10" aria-labelledby="welcome-heading">
      <div className="grid max-w-xl gap-2">
        <h2 id="welcome-heading" className="text-subheading">Make your first form</h2>
        <p className="text-body text-muted-foreground">
          Start from one of these templates, or from a blank page. Every form works in all three layouts, so you can switch later.
        </p>
      </div>

      <div className="grid gap-4 @3xl:grid-cols-3">
        {templates.isPending && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
        {suggested.map((t) => (
          <TemplateCard key={t.id} template={t} className="bg-background" onUse={() => start(t.id, t.id)} busy={pending === t.id} disabled={pending !== null} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => start('blank')} disabled={pending !== null}>
          {pending === 'blank' ? <Spinner /> : <FilePlus2 aria-hidden />}
          {pending === 'blank' ? 'Creating…' : 'Start blank'}
        </Button>
        {templates.isError && <span className="text-body-sm text-muted-foreground">Templates didn’t load. You can still start blank.</span>}
      </div>
    </section>
  )
}
