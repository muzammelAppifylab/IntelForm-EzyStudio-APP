import type { FieldRendererProps } from '@/respondent/types'
import { Group, SubLabel, TextInput } from '@/respondent/ui'

interface NameValue {
  first?: string
  last?: string
}

/** One box (a string) or first + last ({ first, last }). */
export default function NameRenderer(p: FieldRendererProps<'name'>) {
  const { field, value, onChange, inputId, describedBy, invalid, onAdvance, labels } = p
  if (!field.props.split) {
    return (
      <TextInput
        id={inputId}
        autoComplete="name"
        autoCapitalize="words"
        placeholder={field.placeholder || labels.typeAnswer}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        invalid={invalid}
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v === '' ? undefined : v)}
        onAdvance={onAdvance}
      />
    )
  }
  const v = (value && typeof value === 'object' ? value : {}) as NameValue
  const set = (part: 'first' | 'last', text: string) => {
    const next = { first: v.first ?? '', last: v.last ?? '', [part]: text }
    onChange(next.first === '' && next.last === '' ? undefined : next)
  }
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required}>
      <div className="grid gap-3 @md:grid-cols-2">
        <div className="grid gap-1.5">
          <SubLabel htmlFor={inputId}>{labels.firstName}</SubLabel>
          <TextInput
            id={inputId}
            autoComplete="given-name"
            autoCapitalize="words"
            aria-required={field.required || undefined}
            invalid={invalid}
            value={v.first ?? ''}
            onValueChange={(t) => set('first', t)}
            onAdvance={onAdvance}
          />
        </div>
        <div className="grid gap-1.5">
          <SubLabel htmlFor={`${inputId}-last`}>{labels.lastName}</SubLabel>
          <TextInput
            id={`${inputId}-last`}
            autoComplete="family-name"
            autoCapitalize="words"
            invalid={invalid}
            value={v.last ?? ''}
            onValueChange={(t) => set('last', t)}
            onAdvance={onAdvance}
          />
        </div>
      </div>
    </Group>
  )
}
