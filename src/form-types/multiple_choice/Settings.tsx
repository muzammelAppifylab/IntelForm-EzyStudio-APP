import {NumberRow, SegmentRow, SwitchRow} from '../../portal/intelform/builder/controls';
import {OptionsEditor} from '../../portal/intelform/builder/OptionsEditor';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function MultipleChoiceSettings({field, onChange, readOnly}: FieldSettingsProps<'multiple_choice'>) {
  const p = field.props;
  const count = p.options.length + (p.other ? 1 : 0);
  return (
    <div className="fts-stack">
      <OptionsEditor fieldName={field.label || 'this question'} options={p.options} onChange={(options, key) => onChange({options}, key)} readOnly={readOnly} />
      <SwitchRow label="“Other” option" description="Adds an option with a text box." checked={p.other} onCheckedChange={v => onChange({other: v})} disabled={readOnly} />
      <SwitchRow label="Randomize order" checked={p.randomize} onCheckedChange={v => onChange({randomize: v})} disabled={readOnly} />
      <SegmentRow
        label="Direction"
        value={p.orientation}
        options={[
          {value: 'vertical', label: 'Vertical'},
          {value: 'horizontal', label: 'Horizontal'},
        ]}
        onChange={v => onChange({orientation: v})}
        disabled={readOnly}
      />
      <div className="fts-pair">
        <NumberRow
          label="Min choices"
          value={p.minSelections}
          min={1}
          max={p.maxSelections ?? count}
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
    </div>
  );
}
