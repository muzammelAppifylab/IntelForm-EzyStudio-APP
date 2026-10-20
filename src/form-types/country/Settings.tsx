import type { FieldSettingsProps } from '@/builder/type-ui'
import { CountryMultiPicker, CountrySelect } from '@/builder/CountryPicker'

export default function CountrySettings({ field, onChange, readOnly }: FieldSettingsProps<'country'>) {
  return (
    <div className="grid gap-4">
      <CountrySelect label="Default country" value={field.props.defaultCountry} onChange={(v) => onChange({ defaultCountry: v })} disabled={readOnly} />
      <CountryMultiPicker label="Limit to" value={field.props.limitTo} onChange={(v) => onChange({ limitTo: v })} disabled={readOnly} />
    </div>
  )
}
