import {CountryMultiPicker, CountrySelect} from '../../portal/intelform/builder/CountryPicker';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function CountrySettings({field, onChange, readOnly}: FieldSettingsProps<'country'>) {
  return (
    <div className="fts-stack">
      <CountrySelect label="Default country" value={field.props.defaultCountry} onChange={v => onChange({defaultCountry: v})} disabled={readOnly} />
      <CountryMultiPicker label="Limit to" value={field.props.limitTo} onChange={v => onChange({limitTo: v})} disabled={readOnly} />
    </div>
  );
}
