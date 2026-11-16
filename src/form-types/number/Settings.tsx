import {NumberRow, SwitchRow, TextRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function NumberSettings({field, onChange, readOnly}: FieldSettingsProps<'number'>) {
  const p = field.props;
  return (
    <div className="fts-stack">
      <div className="fts-pair">
        <NumberRow label="Min" value={p.min} integer={false} max={p.max ?? undefined} placeholder="None" onChange={v => onChange({min: v})} disabled={readOnly} />
        <NumberRow label="Max" value={p.max} integer={false} min={p.min ?? undefined} placeholder="None" onChange={v => onChange({max: v})} disabled={readOnly} />
      </div>
      <SwitchRow label="Allow decimals" checked={p.allowDecimals} onCheckedChange={v => onChange({allowDecimals: v})} disabled={readOnly} />
      <div className="fts-pair">
        <TextRow
          label="Prefix"
          value={p.prefix}
          maxLength={10}
          placeholder="e.g. $"
          onChange={v => onChange({prefix: v}, `prefix:${field.id}`)}
          disabled={readOnly}
        />
        <TextRow
          label="Suffix"
          value={p.suffix}
          maxLength={10}
          placeholder="e.g. kg"
          onChange={v => onChange({suffix: v}, `suffix:${field.id}`)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
