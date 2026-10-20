import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { arrayMove } from '@dnd-kit/helpers'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Clock, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { minutesLabel, type FeaturedFormView } from '@shared/api-front'
import { FieldError } from '@/components/ds/FieldError'
import { StatusBadge } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { pickableFormsQuery } from '@/pages/dashboard/front-page/queries'

/**
 * Featured forms: pick from Live forms, drag (or Move up / Move down) to reorder, edit each
 * card's short description. Changes are local until the page is saved.
 */
export function FeaturedForms({
  value,
  onChange,
  readOnly,
  errors,
}: {
  value: FeaturedFormView[]
  onChange: (next: FeaturedFormView[]) => void
  readOnly: boolean
  errors: Record<string, string | undefined>
}) {
  const [announce, setAnnounce] = useState('')
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return
    onChange(arrayMove([...value], from, to))
    setAnnounce(`${value[from].title} moved to position ${to + 1} of ${value.length}`)
  }

  return (
    <div className="grid gap-4">
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-card px-4 py-6 text-center text-body-sm text-muted-foreground">
          No featured forms yet. Add a Live form to show it as a card on the front page.
        </p>
      ) : (
        <DragDropProvider
          onDragEnd={(event) => {
            if (event.canceled) return
            const { source } = event.operation
            if (isSortable(source) && source.initialIndex !== source.index) move(source.initialIndex, source.index)
          }}
        >
          <ol className="grid gap-3" aria-label="Featured forms, in order">
            {value.map((f, i) => (
              <FeaturedRow
                key={f.formId}
                form={f}
                index={i}
                count={value.length}
                readOnly={readOnly}
                error={errors[`featured.${i}.description`]}
                onMove={(to) => move(i, to)}
                onDescription={(description) => onChange(value.map((x) => (x.formId === f.formId ? { ...x, description } : x)))}
                onRemove={() => {
                  onChange(value.filter((x) => x.formId !== f.formId))
                  setAnnounce(`${f.title} removed`)
                }}
              />
            ))}
          </ol>
        </DragDropProvider>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {errors.featured && <FieldError id="featured-error">{errors.featured}</FieldError>}
      {!readOnly && <AddForm featured={value} onAdd={(f) => onChange([...value, f])} />}
    </div>
  )
}

function FeaturedRow({
  form,
  index,
  count,
  readOnly,
  error,
  onMove,
  onDescription,
  onRemove,
}: {
  form: FeaturedFormView
  index: number
  count: number
  readOnly: boolean
  error?: string
  onMove: (to: number) => void
  onDescription: (d: string) => void
  onRemove: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: form.formId, index, disabled: readOnly })
  const descId = `featured-desc-${form.formId}`
  const minutes = minutesLabel(form.minutes)
  return (
    // Read-only: no handle, so leave the item unattached; dnd-kit would make the <li> itself a role=button activator.
    <li ref={readOnly ? undefined : ref} className={cn('grid gap-3 rounded-lg border border-border bg-card p-4', isDragging && 'shadow-pop')}>
      <div className="flex items-start gap-2">
        {!readOnly && (
          <button
            ref={handleRef}
            type="button"
            aria-label={`Drag to reorder ${form.title}`}
            className="focus-ring -ml-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-label">{form.title}</span>
            {!form.isPublic && <StatusBadge status={form.status === 'live' ? 'closed' : form.status} />}
          </div>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <span className="font-mono">/f/{form.slug}</span>
            {minutes && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {minutes}
              </span>
            )}
            {!form.isPublic && <span>Hidden until the form is Live again</span>}
          </span>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center">
            <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${form.title} up`}>
              <ArrowUp aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${form.title} down`}>
              <ArrowDown aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${form.title} from the front page`}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={descId} className="text-caption text-muted-foreground">
          Card description
        </label>
        <Textarea
          id={descId}
          value={form.description}
          readOnly={readOnly}
          maxLength={300}
          rows={2}
          placeholder="One or two sentences on what the form is for"
          aria-invalid={error ? true : undefined}
          onChange={(e) => onDescription(e.target.value)}
          className="min-h-16 text-body-sm"
        />
        {error && <FieldError id={`${descId}-err`}>{error}</FieldError>}
      </div>
    </li>
  )
}

function AddForm({ featured, onAdd }: { featured: FeaturedFormView[]; onAdd: (f: FeaturedFormView) => void }) {
  const [open, setOpen] = useState(false)
  const forms = useQuery({ ...pickableFormsQuery, enabled: open })
  const taken = new Set(featured.map((f) => f.formId))
  const options = (forms.data?.forms ?? []).filter((f) => !taken.has(f.id))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="justify-self-start">
          <Plus aria-hidden />
          Add a form
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search Live forms" />
          <CommandList>
            <CommandEmpty>
              {forms.isPending ? 'Loading forms…' : forms.isError ? 'Forms didn’t load. Close and try again.' : 'No other Live forms. Publish a form to feature it.'}
            </CommandEmpty>
            {options.map((f) => (
              <CommandItem
                key={f.id}
                value={`${f.title} ${f.slug}`}
                onSelect={() => {
                  onAdd({ formId: f.id, title: f.title, slug: f.slug, status: 'live', description: f.description, minutes: f.minutes, isPublic: true })
                  setOpen(false)
                }}
              >
                <span className="grid min-w-0">
                  <span className="truncate">{f.title}</span>
                  <span className="truncate font-mono text-caption text-muted-foreground">/f/{f.slug}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
