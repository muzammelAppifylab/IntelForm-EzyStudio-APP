import {NumberRow, SegmentRow, SwitchRow} from '../../portal/intelform/builder/controls';
import {OptionsEditor} from '../../portal/intelform/builder/OptionsEditor';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

export default function PictureChoiceSettings({field, onChange, readOnly}: FieldSettingsProps<'picture_choice'>) {
  const p = field.props;
  return (
    <div className="fts-stack">
      <OptionsEditor
        picture
        fieldName={field.label || 'this question'}
        options={p.options}
        onChange={(options, key) => onChange({options}, key)}
        readOnly={readOnly}
      />
      <SettingsNote>JPG, PNG or WebP, up to 5 MB each. Add alt text so screen reader users know what each picture shows.</SettingsNote>
      <SwitchRow label="Allow several choices" checked={p.multiple} onCheckedChange={v => onChange({multiple: v})} disabled={readOnly} />
      {p.multiple && (
        <div className="fts-pair">
          <NumberRow
            label="Min choices"
            value={p.minSelections}
            min={1}
            max={p.maxSelections ?? p.options.length}
            placeholder="None"
            onChange={v => onChange({minSelections: v})}
            disabled={readOnly}
          />
          <NumberRow
            label="Max choices"
            value={p.maxSelections}
            min={Math.max(1, p.minSelections ?? 1)}
            max={200}
            placeholder="None"
            onChange={v => onChange({maxSelections: v})}
            disabled={readOnly}
          />
        </div>
      )}
      <SegmentRow
        label="Columns"
        value={String(p.columns) as '2' | '3' | '4'}
        options={[
          {value: '2', label: '2'},
          {value: '3', label: '3'},
          {value: '4', label: '4'},
        ]}
        onChange={v => onChange({columns: Number(v)})}
        disabled={readOnly}
      />
      <SwitchRow label="Randomize order" checked={p.randomize} onCheckedChange={v => onChange({randomize: v})} disabled={readOnly} />
    </div>
  );
}
