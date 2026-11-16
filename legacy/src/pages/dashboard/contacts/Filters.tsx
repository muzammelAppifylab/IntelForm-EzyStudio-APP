import { Check, SlidersHorizontal, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { CONTACT_HAS, contactsFilterQuery, type ContactHas, type ContactsOverviewResponse } from '@shared/api-contacts'
import { StatusBadge } from '@/components/ds/StatusBadge'
import { FieldError } from '@/components/ds/FieldError'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleChevron, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { CountryFlag } from './bits'
import { countryLabel, formatNumber, isoDay } from './format'
import { advancedCount, type AdvancedFilters } from './queries'

type Facets = ContactsOverviewResponse['facets']

const HAS_LABEL: Record<ContactHas, string> = { email: 'Email', phone: 'Phone number', name: 'Name' }

const EMPTY: AdvancedFilters = { form: [], country: [], has: [] }

/** "Filters" pill with an active count; opens the advanced filters (a popover, or a sheet on phones). */
export function FiltersButton({ value, facets, onApply }: { value: AdvancedFilters; facets: Facets | undefined; onApply: (f: AdvancedFilters) => void }) {
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const n = advancedCount(value)
  const trigger = (
    <button
      type="button"
      aria-label={n ? `Filters, ${n} active` : 'Filters'}
      className={cn(
        'focus-ring press inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-label whitespace-nowrap transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        n > 0 ? 'bg-option-selected text-option-selected-foreground hover:bg-option-selected' : 'bg-card text-foreground',
      )}
    >
      <SlidersHorizontal className="size-4" aria-hidden />
      Filters
      {n > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-caption font-semibold tabular-nums text-background" aria-hidden>
          {n}
        </span>
      )}
    </button>
  )
  const panel = (
    <FiltersPanel
      key={open ? 'open' : 'closed'}
      initial={value}
      facets={facets}
      mobile={mobile}
      onApply={(f) => {
        onApply(f)
        setOpen(false)
      }}
    />
  )

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow the list by form, country, details and activity.</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        collisionPadding={16}
        className="flex max-h-(--radix-popover-content-available-height) w-[min(26rem,calc(100vw-2rem))] flex-col p-0"
        aria-label="Filters"
      >
        {panel}
      </PopoverContent>
    </Popover>
  )
}

function FiltersPanel({ initial, facets, mobile, onApply }: { initial: AdvancedFilters; facets: Facets | undefined; mobile: boolean; onApply: (f: AdvancedFilters) => void }) {
  const [draft, setDraft] = useState<AdvancedFilters>(initial)
  const [minText, setMinText] = useState(initial.min?.toString() ?? '')
  const [maxText, setMaxText] = useState(initial.max?.toString() ?? '')
  const [today] = useState(() => isoDay(new Date()))
  const ids = useId()
  const set = (patch: Partial<AdvancedFilters>) => setDraft((d) => ({ ...d, ...patch }))

  const toCount = (t: string) => (t.trim() === '' ? undefined : Number(t))
  const candidate = { ...draft, min: toCount(minText), max: toCount(maxText) }
  const parsed = contactsFilterQuery.safeParse({ ...candidate, from: candidate.from || undefined, to: candidate.to || undefined })
  const errors: Partial<Record<'from' | 'to' | 'min' | 'max', string>> = {}
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path[0]
      if ((k === 'from' || k === 'to' || k === 'min' || k === 'max') && !errors[k]) {
        errors[k] = k === 'min' || k === 'max' ? (issue.code === 'invalid_type' || issue.code === 'too_small' ? 'Use a whole number of 1 or more' : issue.message) : issue.message
      }
    }
  }
  const valid = parsed.success

  function apply() {
    if (!parsed.success) return
    const v = parsed.data
    onApply({ form: v.form, country: v.country, has: v.has, from: v.from, to: v.to, min: v.min, max: v.max })
  }
  function reset() {
    setDraft(EMPTY)
    setMinText('')
    setMaxText('')
  }

  const formTitle = (id: string) => facets?.forms.find((f) => f.id === id)?.title ?? 'Form'
  const hasRange = !!(draft.from || draft.to)
  const hasResponses = minText.trim() !== '' || maxText.trim() !== ''
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...draft.form.map((id) => ({ key: `f-${id}`, label: formTitle(id), remove: () => set({ form: draft.form.filter((x) => x !== id) }) })),
    ...draft.country.map((c) => ({ key: `c-${c}`, label: countryLabel(c), remove: () => set({ country: draft.country.filter((x) => x !== c) }) })),
    ...draft.has.map((h) => ({ key: `h-${h}`, label: `Has ${HAS_LABEL[h].toLowerCase()}`, remove: () => set({ has: draft.has.filter((x) => x !== h) }) })),
    ...(hasRange ? [{ key: 'range', label: `${draft.from || 'Any'} to ${draft.to || 'today'}`, remove: () => set({ from: undefined, to: undefined }) }] : []),
    ...(hasResponses
      ? [{ key: 'resp', label: `${minText.trim() || '1'}–${maxText.trim() || 'any'} responses`, remove: () => { setMinText(''); setMaxText('') } }]
      : []),
  ]

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      {!mobile && (
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-label text-foreground">Filters</h2>
          <span className="text-caption text-muted-foreground">Contacts must match every section</span>
        </div>
      )}
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 border-b border-border px-5 pt-1 pb-3" aria-label="Applied filters">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={c.remove}
                aria-label={`Remove ${c.label}`}
                className="focus-ring press inline-flex h-6 max-w-48 cursor-pointer items-center gap-1 rounded-full bg-option-selected pr-1.5 pl-2.5 text-caption text-option-selected-foreground transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent"
              >
                <span className="truncate">{c.label}</span>
                <X className="size-3 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section label="Forms" hint="Contacts who answered any of these" count={draft.form.length} defaultOpen>
          <MultiPick
            label="forms"
            placeholder="Search forms"
            empty="No forms match"
            selected={draft.form}
            onChange={(form) => set({ form })}
            items={(facets?.forms ?? []).map((f) => ({
              value: f.id,
              search: f.title,
              node: (
                <>
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  <StatusBadge status={f.status} className="h-5 px-2" />
                  <span className="w-8 text-right text-caption tabular-nums text-muted-foreground">{formatNumber(f.contacts)}</span>
                </>
              ),
            }))}
          />
        </Section>
        <Section label="Country" hint="From each contact’s latest response" count={draft.country.length}>
          <MultiPick
            label="countries"
            placeholder="Search countries"
            empty="No countries match"
            selected={draft.country}
            onChange={(country) => set({ country })}
            items={(facets?.countries ?? []).map((c) => ({
              value: c.code,
              search: `${countryLabel(c.code)} ${c.code}`,
              node: (
                <>
                  <CountryFlag code={c.code} />
                  <span className="min-w-0 flex-1 truncate">{countryLabel(c.code)}</span>
                  <span className="w-8 text-right text-caption tabular-nums text-muted-foreground">{formatNumber(c.contacts)}</span>
                </>
              ),
            }))}
          />
        </Section>
        <Section label="Has details" hint="Every ticked detail must be present" count={draft.has.length}>
          <div className="flex flex-wrap gap-2">
            {CONTACT_HAS.map((h) => {
              const on = draft.has.includes(h)
              return (
                <button
                  key={h}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ has: CONTACT_HAS.filter((x) => (x === h ? !on : draft.has.includes(x))) })}
                  className={cn(
                    'focus-ring press inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-body-sm transition-[background-color,scale] duration-(--duration-fast) ease-out',
                    on ? 'border-2 border-border-ink bg-option-selected text-option-selected-foreground' : 'border-input bg-card text-foreground hover:bg-accent',
                  )}
                >
                  {on && <Check className="size-3.5 animate-pop-in" strokeWidth={3} aria-hidden />}
                  {HAS_LABEL[h]}
                </button>
              )
            })}
          </div>
        </Section>
        <Section label="Last active" hint="Between these dates, inclusive" count={hasRange ? 1 : 0}>
          <div className="grid grid-cols-2 gap-3">
            <SmallField id={`${ids}-from`} label="From" error={errors.from}>
              <Input id={`${ids}-from`} type="date" max={today} value={draft.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} aria-invalid={!!errors.from} aria-describedby={errors.from ? `${ids}-from-error` : undefined} />
            </SmallField>
            <SmallField id={`${ids}-to`} label="To" error={errors.to}>
              <Input id={`${ids}-to`} type="date" max={today} value={draft.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} aria-invalid={!!errors.to} aria-describedby={errors.to ? `${ids}-to-error` : undefined} />
            </SmallField>
          </div>
        </Section>
        <Section label="Responses sent" hint="Leave a side empty for no limit" count={hasResponses ? 1 : 0}>
          <div className="grid grid-cols-2 gap-3">
            <SmallField id={`${ids}-min`} label="At least" error={errors.min}>
              <Input id={`${ids}-min`} type="number" inputMode="numeric" min={1} step={1} placeholder="1" value={minText} onChange={(e) => setMinText(e.target.value)} aria-invalid={!!errors.min} aria-describedby={errors.min ? `${ids}-min-error` : undefined} />
            </SmallField>
            <SmallField id={`${ids}-max`} label="At most" error={errors.max}>
              <Input id={`${ids}-max`} type="number" inputMode="numeric" min={1} step={1} placeholder="Any" value={maxText} onChange={(e) => setMaxText(e.target.value)} aria-invalid={!!errors.max} aria-describedby={errors.max ? `${ids}-max-error` : undefined} />
            </SmallField>
          </div>
        </Section>
      </div>

      {mobile ? (
        <SheetFooter className="flex-row justify-end border-t border-border">
          <Footer reset={reset} valid={valid} />
        </SheetFooter>
      ) : (
        <div className="flex items-center justify-end gap-2 border-t border-border p-3">
          <Footer reset={reset} valid={valid} />
        </div>
      )}
    </form>
  )
}

function Footer({ reset, valid }: { reset: () => void; valid: boolean }) {
  return (
    <>
      <Button type="button" variant="ghost" onClick={reset}>
        Reset all
      </Button>
      <Button type="submit" disabled={!valid}>
        Apply filters
      </Button>
    </>
  )
}

/** Collapsible filter section: the header shows how many picks it holds, so closed sections still tell the story. */
function Section({ label, hint, count, defaultOpen, children }: { label: string; hint: string; count: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen || count > 0)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-(--duration-fast) ease-out hover:bg-accent">
        <CollapsibleChevron className="text-muted-foreground" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-label text-foreground">{label}</span>
          {open && <span className="text-caption text-muted-foreground">{hint}</span>}
        </span>
        {count > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-caption font-semibold tabular-nums text-background">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-5 pt-1 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SmallField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      {children}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}

interface PickItem {
  value: string
  search: string
  node: ReactNode
}

/** Searchable checklist (cmdk): the picked ones float to the top so they stay visible. */
function MultiPick({ label, placeholder, empty, items, selected, onChange }: { label: string; placeholder: string; empty: string; items: PickItem[]; selected: string[]; onChange: (v: string[]) => void }) {
  // What was picked when the panel opened stays on top; new picks don't jump around.
  const [pinned] = useState(() => new Set(selected))
  const list = [...items].sort((a, b) => Number(pinned.has(b.value)) - Number(pinned.has(a.value)))
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  if (!items.length) return <p className="rounded-md border border-dashed border-input px-3 py-4 text-body-sm text-muted-foreground">Nothing to pick yet.</p>
  return (
    <Command className="rounded-md border border-input bg-field" label={`Pick ${label}`}>
      {items.length > 6 && <CommandInput placeholder={placeholder} aria-label={placeholder} />}
      <CommandList className="max-h-48 p-1">
        <CommandEmpty>{empty}</CommandEmpty>
        {list.map((it) => {
          const on = selected.includes(it.value)
          return (
            <CommandItem key={it.value} value={`${it.search} ${it.value}`} onSelect={() => toggle(it.value)} className="cursor-pointer gap-2.5">
              <span
                aria-hidden
                className={cn(
                  'grid size-4 shrink-0 place-content-center rounded-sm border transition-colors duration-(--duration-fast) ease-out',
                  on ? 'border-border-ink bg-primary text-primary-foreground' : 'border-input bg-field',
                )}
              >
                {on && <Check className="size-3.5 animate-pop-in text-current" strokeWidth={3} />}
              </span>
              <span className="sr-only">{on ? 'Picked: ' : 'Not picked: '}</span>
              {it.node}
            </CommandItem>
          )
        })}
      </CommandList>
      {selected.length > 0 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-caption text-muted-foreground">
          <span className="tabular-nums">{formatNumber(selected.length)} picked</span>
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      )}
    </Command>
  )
}
