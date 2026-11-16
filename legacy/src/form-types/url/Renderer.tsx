import type { FieldRendererProps } from '@/respondent/types'
import { TextInput } from '@/respondent/ui'

export default function UrlRenderer({ field, value, onChange, inputId, describedBy, invalid, onAdvance }: FieldRendererProps<'url'>) {
  return (
    <TextInput
      id={inputId}
      type="url"
      inputMode="url"
      autoComplete="url"
      autoCapitalize="none"
      spellCheck={false}
      placeholder={field.placeholder || 'https://'}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      invalid={invalid}
      value={typeof value === 'string' ? value : ''}
      onValueChange={(v) => onChange(v === '' ? undefined : v)}
      onAdvance={onAdvance}
    />
  )
}
