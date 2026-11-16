import { useEffect, useMemo } from 'react'
import { COUNTRY_CODES } from '@shared/form/types/countries'
import { Combobox } from '@/respondent/Combobox'
import type { FieldRendererProps } from '@/respondent/types'
import { regionName } from '@/respondent/util'

/** Country names from Intl.DisplayNames in the form's language; the answer is the ISO code. */
export default function CountryRenderer({ field, value, onChange, inputId, describedBy, invalid, onAdvance, labels }: FieldRendererProps<'country'>) {
  const options = useMemo(() => {
    const codes = field.props.limitTo.length ? field.props.limitTo : COUNTRY_CODES
    return codes.map((c) => ({ value: c, label: regionName(c) })).sort((a, b) => a.label.localeCompare(b.label))
  }, [field.props.limitTo])
  const def = field.props.defaultCountry
  useEffect(() => {
    if (value === undefined && def && options.some((o) => o.value === def)) onChange(def, { silent: true })
    // Only on first render: a cleared answer stays cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Combobox
      id={inputId}
      options={options}
      value={typeof value === 'string' ? value : null}
      onChange={(v) => onChange(v ?? undefined)}
      placeholder={field.placeholder || labels.choose}
      noResults={labels.noResults}
      describedBy={describedBy}
      invalid={invalid}
      onAdvance={onAdvance}
      autoComplete="country-name"
    />
  )
}
