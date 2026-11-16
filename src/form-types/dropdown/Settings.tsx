import {SwitchRow} from '../../portal/intelform/builder/controls';
import {OptionsEditor} from '../../portal/intelform/builder/OptionsEditor';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function DropdownSettings({field, onChange, readOnly}: FieldSettingsProps<'dropdown'>) {
  const p = field.props;
  return (
    <div className="fts-stack">
      <OptionsEditor fieldName={field.label || 'this question'} options={p.options} onChange={(options, key) => onChange({options}, key)} readOnly={readOnly} />
      <SwitchRow
        label="Searchable"
        description="Respondents can type to filter long lists."
        checked={p.searchable}
        onCheckedChange={v => onChange({searchable: v})}
        disabled={readOnly}
      />
      <SwitchRow label="Randomize order" checked={p.randomize} onCheckedChange={v => onChange({randomize: v})} disabled={readOnly} />
    </div>
  );
}
