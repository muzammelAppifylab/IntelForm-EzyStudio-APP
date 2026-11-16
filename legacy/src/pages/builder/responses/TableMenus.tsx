import { ArrowDown, ArrowUp, Columns3, ListFilter } from 'lucide-react'
import type { CatalogField, TableColumnPref } from '@shared/api-responses'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** "Filter" menu: one submenu per choice question, options as checkboxes (OR within a question). */
export function FilterMenu({ fields, active, onChange }: { fields: CatalogField[]; active: string[]; onChange: (filter: string[]) => void }) {
  const choices = fields.filter((f) => f.filterable && f.options?.length)
  if (!choices.length) return null
  const toggle = (key: string, on: boolean) => onChange(on ? [...active, key] : active.filter((x) => x !== key))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(active.length > 0 && 'bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground')}>
          <ListFilter aria-hidden />
          Filter{active.length ? ` (${active.length})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Filter by answer</DropdownMenuLabel>
        {choices.map((f) => {
          const n = active.filter((x) => x.startsWith(`${f.id}:`)).length
          return (
            <DropdownMenuSub key={f.id}>
              <DropdownMenuSubTrigger>
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                {n > 0 && <span className="text-caption text-muted-foreground tabular-nums">{n}</span>}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
                {f.options!.map((o) => {
                  const key = `${f.id}:${o.id}`
                  return (
                    <DropdownMenuCheckboxItem key={o.id} checked={active.includes(key)} onCheckedChange={(v) => toggle(key, !!v)} onSelect={(e) => e.preventDefault()}>
                      <span className="truncate">{o.label}</span>
                    </DropdownMenuCheckboxItem>
                  )
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Show / hide and reorder columns. Saved per user per form. */
export function ColumnsMenu({
  columns,
  labelOf,
  onChange,
  onReset,
}: {
  columns: TableColumnPref[]
  labelOf: (id: string) => string
  onChange: (columns: TableColumnPref[]) => void
  onReset: () => void
}) {
  const move = (i: number, d: -1 | 1) => {
    const next = columns.slice()
    const [c] = next.splice(i, 1)
    next.splice(i + d, 0, c)
    onChange(next)
  }
  const visibleCount = columns.filter((c) => c.visible).length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 aria-hidden />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-2 p-2">
        <div className="flex items-center justify-between px-2 pt-1">
          <span className="text-label text-foreground">Columns</span>
          <Button variant="ghost" size="xs" onClick={onReset}>
            Reset
          </Button>
        </div>
        <ul className="grid max-h-96 overflow-y-auto" aria-label="Columns">
          {columns.map((c, i) => {
            const label = labelOf(c.id)
            const id = `col-${c.id}`
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/60">
                <Checkbox
                  id={id}
                  checked={c.visible}
                  // Keep at least one column.
                  disabled={c.visible && visibleCount === 1}
                  onCheckedChange={(v) => onChange(columns.map((x) => (x.id === c.id ? { ...x, visible: !!v } : x)))}
                />
                <label htmlFor={id} className="min-w-0 flex-1 truncate text-body-sm text-foreground">
                  {label}
                </label>
                <Button variant="ghost" size="icon-xs" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Move ${label} down`} disabled={i === columns.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
