import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns3, LayoutGrid, Rows3, Search, X } from 'lucide-react'
import { CONTACT_SEGMENT_LABEL, CONTACT_SEGMENTS, CONTACT_SORT_LABEL, CONTACT_SORTS, type ContactSegment, type ContactSort, type ContactsOverviewResponse, type ContactsStrip } from '@shared/api-contacts'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { countryLabel, formatDay, formatNumber } from './format'
import { COLUMN_LABEL, COLUMNS, type AdvancedFilters, type ColumnId, type ContactsView } from './queries'

const PILL =
  'focus-ring press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-label whitespace-nowrap transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out'
const ROUND =
  'focus-ring press grid size-9 shrink-0 cursor-pointer place-items-center rounded-md border border-border bg-card text-foreground transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50'

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative min-w-0 flex-1 basis-64 @5xl:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, email or phone"
        aria-label="Search contacts by name, email or phone"
        className="pl-9"
      />
    </div>
  )
}

/** All / New this week / Returning, each with its workspace count. */
export function SegmentPills({ value, onChange, strip }: { value: ContactSegment; onChange: (v: ContactSegment) => void; strip: ContactsStrip | undefined }) {
  const counts: Record<ContactSegment, number | undefined> = { all: strip?.total, new: strip?.newThisWeek, returning: strip?.returning }
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {CONTACT_SEGMENTS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={cn(
            PILL,
            value === s ? 'border-border-ink bg-option-selected text-option-selected-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {CONTACT_SEGMENT_LABEL[s]}
          {counts[s] !== undefined && <span className="tabular-nums">{formatNumber(counts[s])}</span>}
        </button>
      ))}
    </div>
  )
}

export function SortControls({ sort, dir, onSort, onDir }: { sort: ContactSort; dir: 'asc' | 'desc'; onSort: (s: ContactSort) => void; onDir: (d: 'asc' | 'desc') => void }) {
  const next = dir === 'asc' ? 'desc' : 'asc'
  const label = dir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'
  return (
    <div className="flex items-center gap-1.5">
      <Select value={sort} onValueChange={(v) => onSort(v as ContactSort)}>
        <SelectTrigger className="w-auto min-w-36 gap-2 text-label" aria-label="Sort contacts">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONTACT_SORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {CONTACT_SORT_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={ROUND} aria-label={label} onClick={() => onDir(next)}>
            {dir === 'asc' ? <ArrowUpNarrowWide className="size-4" aria-hidden /> : <ArrowDownWideNarrow className="size-4" aria-hidden />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{dir === 'asc' ? 'Ascending' : 'Descending'}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ColumnsMenu({ hidden, onChange }: { hidden: ColumnId[]; onChange: (cols: ColumnId[]) => void }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ROUND} aria-label="Show or hide columns">
              <Columns3 className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Columns</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem
            key={c}
            checked={!hidden.includes(c)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => onChange(v ? hidden.filter((x) => x !== c) : [...hidden, c])}
          >
            {COLUMN_LABEL[c]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={hidden.length === 0} onSelect={() => onChange([])}>
          Show all columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ViewToggle({ view, onChange }: { view: ContactsView; onChange: (v: ContactsView) => void }) {
  return (
    <div role="group" aria-label="View" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {(
        [
          ['table', Rows3, 'Table view'],
          ['cards', LayoutGrid, 'Card view'],
        ] as const
      ).map(([v, Icon, label]) => (
        <button
          key={v}
          type="button"
          aria-label={label}
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            'focus-ring press grid size-7 cursor-pointer place-items-center rounded-md border transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out',
            view === v ? 'border-border-ink bg-card text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}

/** One removable chip per active advanced filter, then "Clear all". */
export function ActiveFilters({
  value,
  facets,
  onChange,
}: {
  value: AdvancedFilters
  facets: ContactsOverviewResponse['facets'] | undefined
  onChange: (patch: Partial<Record<keyof AdvancedFilters, string[] | string | number | null>>) => void
}) {
  const formTitle = (id: string) => facets?.forms.find((f) => f.id === id)?.title ?? 'Form'
  const chips: { key: string; label: string; remove: () => void }[] = []
  for (const id of value.form) chips.push({ key: `f:${id}`, label: `Form: ${formTitle(id)}`, remove: () => onChange({ form: value.form.filter((x) => x !== id) }) })
  for (const c of value.country) chips.push({ key: `c:${c}`, label: `Country: ${countryLabel(c)}`, remove: () => onChange({ country: value.country.filter((x) => x !== c) }) })
  for (const h of value.has) chips.push({ key: `h:${h}`, label: `Has ${h === 'phone' ? 'phone number' : h}`, remove: () => onChange({ has: value.has.filter((x) => x !== h) }) })
  if (value.from || value.to) {
    const label = value.from && value.to ? `${formatDay(value.from)} – ${formatDay(value.to)}` : value.from ? `since ${formatDay(value.from)}` : `until ${formatDay(value.to!)}`
    chips.push({ key: 'date', label: `Last active ${label}`, remove: () => onChange({ from: null, to: null }) })
  }
  if (value.min !== undefined || value.max !== undefined) {
    const { min, max } = value
    const label =
      min !== undefined && max !== undefined
        ? min === max
          ? `${formatNumber(min)} ${min === 1 ? 'response' : 'responses'}`
          : `${formatNumber(min)}–${formatNumber(max)} responses`
        : min !== undefined
          ? `At least ${formatNumber(min)} ${min === 1 ? 'response' : 'responses'}`
          : `At most ${formatNumber(max!)} ${max === 1 ? 'response' : 'responses'}`
    chips.push({ key: 'count', label, remove: () => onChange({ min: null, max: null }) })
  }
  if (!chips.length) return null
  return (
    <ul className="-mt-3 flex animate-fade-up flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <li key={c.key} className="min-w-0">
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-card py-0.5 pr-1 pl-2.5 text-body-sm text-foreground">
            <span className="max-w-72 truncate">{c.label}</span>
            <Button variant="ghost" size="icon-xs" aria-label={`Remove filter: ${c.label}`} onClick={c.remove}>
              <X aria-hidden />
            </Button>
          </span>
        </li>
      ))}
      <li>
        <Button variant="link" size="sm" className="px-1" onClick={() => onChange({ form: null, country: null, has: null, from: null, to: null, min: null, max: null })}>
          Clear all
        </Button>
      </li>
    </ul>
  )
}
