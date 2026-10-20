import { useState } from 'react'
import { useDraggable } from '@dnd-kit/react'
import { Search } from 'lucide-react'
import { FIELD_GROUP_LABEL, FIELD_GROUPS, FIELD_TYPE_META, FIELD_TYPES, type FieldType } from '@shared/form/field-types'
import { matchesType } from '@/builder/palette-search'
import { Input } from '@/components/ui/input'
import { cn } from '@/components/ui/cn'
import { FIELD_ICONS } from '@/form-types/icons'
import { useBuilder, useBuilderStore } from '@/builder/store'

/** Left pane: field types by group. Click appends; drag places it on the canvas. */
export function Palette() {
  const [query, setQuery] = useState('')
  const readOnly = useBuilder((s) => s.readOnly)
  const groups = FIELD_GROUPS.map((g) => ({ g, types: FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].group === g && matchesType(t, query)) })).filter((x) => x.types.length)

  return (
    <aside aria-label="Question types" className="flex min-h-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search question types"
            placeholder="Search question types"
            className="h-(--control-sm) pl-9 text-body-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {groups.length === 0 && <p className="px-2 text-body-sm text-muted-foreground">No question type matches “{query}”.</p>}
        {groups.map(({ g, types }) => (
          <section key={g} className="mb-4">
            <h3 className="px-2 pb-1.5 text-overline text-muted-foreground">{FIELD_GROUP_LABEL[g]}</h3>
            <ul className="grid gap-0.5">
              {types.map((t) => (
                <li key={t}>
                  <PaletteItem type={t} disabled={readOnly} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!readOnly && <p className="px-2 pt-2 text-caption text-muted-foreground">Tip: press / on the canvas to add a question below the selected one.</p>}
      </div>
    </aside>
  )
}

function PaletteItem({ type, disabled }: { type: FieldType; disabled: boolean }) {
  const store = useBuilderStore()
  const { ref, isDragSource } = useDraggable({ id: `palette:${type}`, type: 'palette', data: { fieldType: type }, disabled })
  const Icon = FIELD_ICONS[type]
  const label = FIELD_TYPE_META[type].label
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={`Add ${label}`}
      onClick={() => {
        store.getState().addField(type)
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-card-id="${store.getState().selection}"]`)
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        })
      }}
      className={cn(
        'focus-ring group flex w-full cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-body-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
        isDragSource && 'opacity-50',
      )}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground group-hover:bg-card group-hover:text-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      {label}
    </button>
  )
}
