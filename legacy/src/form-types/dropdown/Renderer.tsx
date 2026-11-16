import { useMemo, useState } from 'react'
import { Combobox } from '@/respondent/Combobox'
import type { FieldRendererProps } from '@/respondent/types'
import { NativeSelect } from '@/respondent/ui'
import { shuffled } from '@/respondent/util'

/** Searchable combobox, or a native select when search is off. Answer: { option }. */
export default function DropdownRenderer({ field, value, onChange, inputId, describedBy, invalid, onAdvance, labels }: FieldRendererProps<'dropdown'>) {
  const [seed] = useState(() => Math.floor(Math.random() * 1e9))
  const options = useMemo(
    () => (field.props.randomize ? shuffled(field.props.options, seed) : field.props.options).map((o) => ({ value: o.id, label: o.label })),
    [field.props.options, field.props.randomize, seed],
  )
  const selected = value && typeof value === 'object' ? ((value as { option?: string }).option ?? null) : null
  const set = (v: string | null) => onChange(v ? { option: v } : undefined)
  if (field.props.searchable) {
    return (
      <Combobox
        id={inputId}
        options={options}
        value={selected}
        onChange={set}
        placeholder={field.placeholder || labels.choose}
        noResults={labels.noResults}
        describedBy={describedBy}
        invalid={invalid}
        onAdvance={onAdvance}
      />
    )
  }
  return (
    <NativeSelect
      id={inputId}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      invalid={invalid}
      value={selected ?? ''}
      onChange={(e) => set(e.target.value || null)}
    >
      <option value="">{field.placeholder || labels.choose}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  )
}
