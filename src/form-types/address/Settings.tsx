import {SwitchRow} from '../../portal/intelform/builder/controls';
import {CountrySelect} from '../../portal/intelform/builder/CountryPicker';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {ADDRESS_LINES, type AddressLine} from '../../lib/intelform/form/types/registry';

const LINE_LABEL: Record<AddressLine, string> = {
  street: 'Street address',
  line2: 'Address line 2',
  city: 'City',
  state: 'State / province',
  postal: 'Postal code',
  country: 'Country',
};

export default function AddressSettings({field, onChange, readOnly}: FieldSettingsProps<'address'>) {
  const lines = field.props.lines;
  const enabled = ADDRESS_LINES.filter(l => lines[l]).length;
  return (
    <div className="fts-stack fts-stack-tight">
      <span className="fts-label">Lines</span>
      {ADDRESS_LINES.map(l => (
        <SwitchRow
          key={l}
          label={LINE_LABEL[l]}
          checked={lines[l]}
          // The last enabled line can't be switched off.
          disabled={readOnly || (lines[l] && enabled === 1)}
          onCheckedChange={v => onChange({lines: {...lines, [l]: v}})}
        />
      ))}
      {lines.country && (
        <CountrySelect label="Default country" value={field.props.defaultCountry} onChange={v => onChange({defaultCountry: v})} disabled={readOnly} />
      )}
    </div>
  );
}
