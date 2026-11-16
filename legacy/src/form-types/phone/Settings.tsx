import type { FieldSettingsProps } from '@/builder/type-ui'
import { CountrySelect } from '@/builder/CountryPicker'

export default function PhoneSettings({ field, onChange, readOnly }: FieldSettingsProps<'phone'>) {
  return (
    <CountrySelect
      label="Default country code"
      description="Preselected in the dial-code picker. Numbers are stored with their country code."
      value={field.props.defaultCountry}
      onChange={(v) => onChange({ defaultCountry: v })}
      disabled={readOnly}
    />
  )
}
