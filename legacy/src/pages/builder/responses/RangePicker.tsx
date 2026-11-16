import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { SUMMARY_RANGE_LABEL, type SummaryRange } from '@shared/api-responses'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDay, isoDay, parseDay } from './format'

const PRESETS: { id: Exclude<SummaryRange, 'custom'>; short: string }[] = [
  { id: '7d', short: '7 days' },
  { id: '30d', short: '30 days' },
  { id: '90d', short: '90 days' },
  { id: 'all', short: 'All' },
]

/** Calendar range in a popover; "Apply" commits. Used by the summary range and the table filter. */
export function CalendarRange({
  from,
  to,
  onApply,
  onClear,
  label,
  active,
}: {
  from?: string
  to?: string
  onApply: (from: string, to: string) => void
  onClear?: () => void
  label: string
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const [today] = useState(() => new Date())
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft({ from: parseDay(from), to: parseDay(to) })
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-pressed={active} className={cn(active && 'bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground')}>
          <CalendarDays aria-hidden />
          {active && from && to ? `${formatDay(from)} – ${formatDay(to)}` : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={draft}
          onSelect={setDraft}
          defaultMonth={draft?.from ?? new Date(today.getFullYear(), today.getMonth() - 1, 1)}
          disabled={{ after: today }}
        />
        <div className="flex items-center justify-end gap-2 border-t border-border p-3">
          {onClear && active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
            >
              Clear dates
            </Button>
          )}
          <Button
            size="sm"
            disabled={!draft?.from}
            onClick={() => {
              if (!draft?.from) return
              onApply(isoDay(draft.from), isoDay(draft.to ?? draft.from))
              setOpen(false)
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RangePicker({
  range,
  from,
  to,
  onChange,
}: {
  range: SummaryRange
  from?: string
  to?: string
  onChange: (range: SummaryRange, from?: string, to?: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={range === 'custom' ? '' : range}
        onValueChange={(v) => v && onChange(v as SummaryRange)}
        aria-label="Date range"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p.id} value={p.id} aria-label={SUMMARY_RANGE_LABEL[p.id]} className="px-3">
            {p.short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <CalendarRange
        label="Custom"
        from={from}
        to={to}
        active={range === 'custom'}
        onApply={(f, t) => onChange('custom', f, t)}
      />
    </div>
  )
}
