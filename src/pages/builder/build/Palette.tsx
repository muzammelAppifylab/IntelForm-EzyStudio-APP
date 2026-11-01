import { useState } from 'react'
import { useDraggable } from '@dnd-kit/react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { FIELD_GROUP_LABEL, FIELD_GROUPS, FIELD_TYPE_META, FIELD_TYPES, type FieldType } from '@shared/form/field-types'
import { matchesType } from '@/builder/palette-search'
import { fieldTint } from '@/builder/type-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/components/ui/cn'
import { FIELD_ICONS } from '@/form-types/icons'
import { useBuilder, useBuilderStore } from '@/builder/store'

/**
 * Left card: "Add a field" with search and the field types as two-column chips by group. Click
 * appends; drag places it on the canvas. Collapses to an icon rail.
 */
export function Palette({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const [query, setQuery] = useState('')
  const readOnly = useBuilder((s) => s.readOnly)
  const groups = FIELD_GROUPS.map((g) => ({ g, types: FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].group === g && matchesType(t, collapsed ? '' : query)) })).filter((x) => x.types.length)

  return (
    <aside aria-label="Question types" className="@container flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className={cn('flex items-center gap-2 pt-5', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
        {!collapsed && <h2 className="text-heading-sm">Add a field</h2>}
        <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={collapsed ? 'Expand field list' : 'Collapse field list'} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight aria-hidden /> : <ChevronLeft aria-hidden />}
        </Button>
      </div>
      {!collapsed && (
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search question types"
              placeholder="Search fields"
              className="border-paper-300 pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      )}
      <div className={cn('min-h-0 flex-1 overflow-y-auto pt-4 pb-5', collapsed ? 'px-2' : 'px-4')}>
        {groups.length === 0 && <p className="text-body-sm text-muted-foreground">No question type matches “{query}”.</p>}
        {groups.map(({ g, types }) => (
          <section key={g} className="mb-5 last:mb-0">
            <h3 className={cn('pb-2 text-overline text-muted-foreground', collapsed && 'sr-only')}>{FIELD_GROUP_LABEL[g]}</h3>
            <ul className={cn('grid gap-1.5', !collapsed && '@[18rem]:grid-cols-2')}>
              {types.map((t) => (
                <li key={t}>
                  <PaletteItem type={t} disabled={readOnly} compact={collapsed} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!readOnly && !collapsed && <p className="pt-1 text-caption text-muted-foreground">Tip: press / on the canvas to add a question below the selected one.</p>}
      </div>
    </aside>
  )
}

function PaletteItem({ type, disabled, compact }: { type: FieldType; disabled: boolean; compact: boolean }) {
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
      title={compact ? label : undefined}
      onClick={() => {
        store.getState().addField(type)
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-card-id="${store.getState().selection}"]`)
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        })
      }}
      className={cn(
        'focus-ring press flex h-9 w-full cursor-grab items-center gap-1.5 rounded-lg border border-border bg-card text-left text-label text-foreground transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out hover:border-paper-400 hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50',
        compact ? 'justify-center px-0' : 'px-1.5',
        isDragSource && 'opacity-50',
      )}
    >
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', fieldTint(type))}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      {!compact && <span className="truncate">{label}</span>}
    </button>
  )
}
