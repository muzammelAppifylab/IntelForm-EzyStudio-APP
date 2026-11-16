import {SegmentRow, SelectRow, TextRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

const SCALES = ['3', '4', '5', '6', '7', '8', '9', '10'] as const;

export default function RatingSettings({field, onChange, readOnly}: FieldSettingsProps<'rating'>) {
  const p = field.props;
  return (
    <div className="fts-stack">
      <SegmentRow
        label="Style"
        value={p.style}
        options={[
          {value: 'stars', label: 'Stars'},
          {value: 'numbers', label: 'Numbers'},
          {value: 'emoji', label: 'Faces'},
        ]}
        onChange={v => onChange({style: v})}
        disabled={readOnly}
      />
      <SelectRow
        label="Scale"
        value={String(p.scale) as (typeof SCALES)[number]}
        options={SCALES.map(s => ({value: s, label: `1 to ${s}`}))}
        onChange={v => onChange({scale: Number(v)})}
        disabled={readOnly}
      />
      <div className="fts-pair">
        <TextRow
          label="Left label"
          value={p.leftLabel}
          maxLength={60}
          placeholder="e.g. Poor"
          onChange={v => onChange({leftLabel: v}, `left:${field.id}`)}
          disabled={readOnly}
        />
        <TextRow
          label="Right label"
          value={p.rightLabel}
          maxLength={60}
          placeholder="e.g. Great"
          onChange={v => onChange({rightLabel: v}, `right:${field.id}`)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
