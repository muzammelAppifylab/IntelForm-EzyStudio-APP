import { useEffect, useMemo } from 'react'
import { ADDRESS_LINES, type AddressLine } from '@shared/form/types/contact'
import { COUNTRY_CODES } from '@shared/form/types/countries'
import type { FieldRendererProps } from '@/respondent/types'
import { Group, NativeSelect, SubLabel, TextInput } from '@/respondent/ui'
import { regionName } from '@/respondent/util'

const AUTOCOMPLETE: Record<AddressLine, string> = {
  street: 'address-line1',
  line2: 'address-line2',
  city: 'address-level2',
  state: 'address-level1',
  postal: 'postal-code',
  country: 'country',
}
const REQUIRED: AddressLine[] = ['street', 'city', 'country']

/** One labelled input per enabled line; country is a select of localised names. */
export default function AddressRenderer(p: FieldRendererProps<'address'>) {
  const { field, value, onChange, labels, onAdvance } = p
  const lines = ADDRESS_LINES.filter((l) => field.props.lines[l])
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<AddressLine, string>>
  const countries = useMemo(() => COUNTRY_CODES.map((c) => ({ c, n: regionName(c) })).sort((a, b) => a.n.localeCompare(b.n)), [])
  const set = (line: AddressLine, text: string) => {
    const next = { ...v, [line]: text }
    const empty = ADDRESS_LINES.every((l) => !next[l] || !next[l]!.trim())
    onChange(empty ? undefined : next)
  }
  useEffect(() => {
    const def = field.props.defaultCountry
    if (def && field.props.lines.country && !v.country) onChange({ ...v, country: def }, { silent: true })
    // First render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const label: Record<AddressLine, string> = {
    street: labels.street,
    line2: labels.line2,
    city: labels.city,
    state: labels.state,
    postal: labels.postal,
    country: labels.country,
  }
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'text-question-xl' : undefined}>
      <div className="grid gap-3 @md:grid-cols-2">
        {lines.map((line, i) => {
          const id = i === 0 ? p.inputId : `${p.inputId}-${line}`
          const req = field.required && REQUIRED.includes(line)
          const wide = line === 'street' || line === 'line2'
          return (
            <div key={line} className={wide ? 'grid gap-1.5 @md:col-span-2' : 'grid gap-1.5'}>
              <SubLabel htmlFor={id}>
                {label[line]}
                {req && <span aria-hidden className="text-destructive"> *</span>}
              </SubLabel>
              {line === 'country' ? (
                <NativeSelect id={id} autoComplete="country" aria-required={req || undefined} invalid={p.invalid} value={v.country ?? ''} onChange={(e) => set('country', e.target.value)}>
                  <option value="">{labels.choose}</option>
                  {countries.map(({ c, n }) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <TextInput
                  id={id}
                  autoComplete={AUTOCOMPLETE[line]}
                  aria-required={req || undefined}
                  invalid={p.invalid}
                  value={v[line] ?? ''}
                  onValueChange={(t) => set(line, t)}
                  onAdvance={onAdvance}
                />
              )}
            </div>
          )
        })}
      </div>
    </Group>
  )
}
