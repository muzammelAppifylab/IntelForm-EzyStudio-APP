import {SelectRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {LengthLimits} from '../_settings/LengthLimits';

const ROWS = ['2', '3', '4', '5', '6', '8', '10', '12', '16', '20'] as const;

export default function LongTextSettings({field, onChange, readOnly}: FieldSettingsProps<'long_text'>) {
  return (
    <div className="fts-stack">
      <LengthLimits min={field.props.minLength} max={field.props.maxLength} cap={10000} onChange={onChange} readOnly={readOnly} />
      <SelectRow
        label="Box height"
        value={String(field.props.rows) as (typeof ROWS)[number]}
        options={ROWS.map(r => ({value: r, label: `${r} lines`}))}
        onChange={v => onChange({rows: Number(v)})}
        disabled={readOnly}
      />
    </div>
  );
}
