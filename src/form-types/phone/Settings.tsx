import {CountrySelect} from '../../portal/intelform/builder/CountryPicker';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function PhoneSettings({field, onChange, readOnly}: FieldSettingsProps<'phone'>) {
  return (
    <CountrySelect
      label="Default country code"
      description="Preselected in the dial-code picker. Numbers are stored with their country code."
      value={field.props.defaultCountry}
      onChange={v => onChange({defaultCountry: v})}
      disabled={readOnly}
    />
  );
}
