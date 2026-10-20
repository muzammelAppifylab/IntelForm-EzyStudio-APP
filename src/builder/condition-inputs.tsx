import { useMemo } from 'react'
import { OTHER_OPTION_ID } from '@shared/form/definition'
import { COUNTRY_CODES, countryName } from '@shared/form/types/registry'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ConditionValueProps } from './type-ui'

/** Value inputs for logic conditions, shared by the per-type ConditionValue files. */

const box = 'h-(--control-sm) text-body-sm'

export function TextValue({ value, onChange, label, readOnly }: ConditionValueProps) {
  return (
    <Input
      aria-label={label}
      className={box}
      value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Text"
      maxLength={500}
      readOnly={readOnly}
    />
  )
}

export function NumberValue({ value, onChange, label, readOnly }: ConditionValueProps) {
  return (
    <Input
      aria-label={label}
      className={box}
      inputMode="decimal"
      value={value === undefined ? '' : String(value)}
      onChange={(e) => {
        const t = e.target.value.trim()
        const n = Number(t)
        onChange(t === '' ? undefined : Number.isFinite(n) && /^-?\d*\.?\d+$/.test(t) ? n : t)
      }}
      placeholder="Number"
      readOnly={readOnly}
    />
  )
}

export function ScaleValue({ value, onChange, label, readOnly, from, to }: ConditionValueProps & { from: number; to: number }) {
  const items = Array.from({ length: to - from + 1 }, (_, i) => String(from + i))
  return (
    <Select value={value === undefined ? undefined : String(value)} onValueChange={(v) => onChange(Number(v))} disabled={readOnly}>
      <SelectTrigger aria-label={label} className={`${box} w-full`}>
        <SelectValue placeholder="Pick" />
      </SelectTrigger>
      <SelectContent>
        {items.map((v) => (
          <SelectItem key={v} value={v}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function DateValue({ value, onChange, label, readOnly }: ConditionValueProps) {
  return (
    <Input type="date" aria-label={label} className={box} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} readOnly={readOnly} />
  )
}

export function TimeValue({ value, onChange, label, readOnly }: ConditionValueProps) {
  return (
    <Input type="time" aria-label={label} className={box} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} readOnly={readOnly} />
  )
}

export function OptionValue({
  value,
  onChange,
  label,
  readOnly,
  options,
  other,
}: ConditionValueProps & { options: readonly { id: string; label: string }[]; other?: boolean }) {
  const items = other ? [...options, { id: OTHER_OPTION_ID, label: 'Other' }] : options
  return (
    <Select value={typeof value === 'string' ? value : undefined} onValueChange={(v) => onChange(v)} disabled={readOnly}>
      <SelectTrigger aria-label={label} className={`${box} w-full`}>
        <SelectValue placeholder="Pick an option" />
      </SelectTrigger>
      <SelectContent>
        {items.map((o, i) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label || `Option ${i + 1}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CountryValue({ value, onChange, label, readOnly, limitTo }: ConditionValueProps & { limitTo?: readonly string[] }) {
  const items = useMemo(
    () =>
      (limitTo?.length ? limitTo : COUNTRY_CODES)
        .map((c) => ({ code: c, name: countryName(c) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [limitTo],
  )
  return (
    <Select value={typeof value === 'string' ? value : undefined} onValueChange={(v) => onChange(v)} disabled={readOnly}>
      <SelectTrigger aria-label={label} className={`${box} w-full`}>
        <SelectValue placeholder="Pick a country" />
      </SelectTrigger>
      <SelectContent>
        {items.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
