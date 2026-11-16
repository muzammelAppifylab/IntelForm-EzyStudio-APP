import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { COUNTRY_CODES, countryName } from '@shared/form/types/registry'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/components/ui/cn'
import { FieldRow } from './controls'

function useCountries() {
  return useMemo(() => COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)), [])
}

/** One country, or none. */
export function CountrySelect({ label, value, onChange, disabled, description }: { label: string; value: string | null; onChange(v: string | null): void; disabled?: boolean; description?: string }) {
  const [open, setOpen] = useState(false)
  const countries = useCountries()
  return (
    <FieldRow label={label} description={description}>
      {({ id, describedBy }) => (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={id} aria-describedby={describedBy} variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
              <span className={cn('truncate', !value && 'text-field-placeholder')}>{value ? countryName(value) : 'None'}</span>
              <ChevronsUpDown className="opacity-60" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search countries" />
              <CommandList>
                <CommandEmpty>No country matches</CommandEmpty>
                <CommandItem value="none" onSelect={() => (onChange(null), setOpen(false))}>
                  <Check className={cn('size-4', value ? 'opacity-0' : 'opacity-100')} aria-hidden />
                  None
                </CommandItem>
                {countries.map((c) => (
                  <CommandItem key={c.code} value={`${c.name} ${c.code}`} onSelect={() => (onChange(c.code), setOpen(false))}>
                    <Check className={cn('size-4', value === c.code ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </FieldRow>
  )
}

/** Several countries; empty means all. */
export function CountryMultiPicker({ label, value, onChange, disabled }: { label: string; value: string[]; onChange(v: string[]): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const countries = useCountries()
  const set = new Set(value)
  const summary = value.length === 0 ? 'All countries' : value.length <= 3 ? value.map((c) => countryName(c)).join(', ') : `${value.length} countries`
  return (
    <FieldRow label={label} description="Offer only these countries. Leave empty to offer every country.">
      {({ id, describedBy }) => (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={id} aria-describedby={describedBy} variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
              <span className="truncate">{summary}</span>
              <ChevronsUpDown className="opacity-60" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search countries" />
              <CommandList>
                <CommandEmpty>No country matches</CommandEmpty>
                {value.length > 0 && (
                  <CommandItem value="clear all" onSelect={() => onChange([])}>
                    Clear (offer all countries)
                  </CommandItem>
                )}
                {countries.map((c) => (
                  <CommandItem
                    key={c.code}
                    value={`${c.name} ${c.code}`}
                    aria-selected={set.has(c.code)}
                    onSelect={() => onChange(set.has(c.code) ? value.filter((x) => x !== c.code) : [...value, c.code])}
                  >
                    <Check className={cn('size-4', set.has(c.code) ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </FieldRow>
  )
}
