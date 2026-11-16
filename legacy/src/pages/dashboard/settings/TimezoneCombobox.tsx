import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function allZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone')
    return zones.includes('UTC') ? zones : ['UTC', ...zones]
  } catch {
    return ['UTC']
  }
}

/** Searchable list of IANA time zones (Intl.supportedValuesOf). */
export function TimezoneCombobox({
  id,
  value,
  onChange,
  disabled,
  ...aria
}: {
  id: string
  value: string
  onChange: (tz: string) => void
  disabled?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const zones = useMemo(() => allZones(), [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between bg-field font-normal sm:w-80"
          {...aria}
        >
          <span className="truncate">{value.replaceAll('_', ' ')}</span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search time zones" />
          <CommandList>
            <CommandEmpty>No time zone matches.</CommandEmpty>
            {zones.map((tz) => (
              <CommandItem
                key={tz}
                value={tz}
                keywords={[tz.replaceAll('_', ' ')]}
                onSelect={() => {
                  onChange(tz)
                  setOpen(false)
                }}
              >
                <Check className={cn('size-4', tz === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                {tz.replaceAll('_', ' ')}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
