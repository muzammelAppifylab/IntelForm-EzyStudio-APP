import {TextRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

export default function NpsSettings({field, onChange, readOnly}: FieldSettingsProps<'nps'>) {
  return (
    <div className="fts-stack fts-stack-tight">
      <SettingsNote>A fixed 0 to 10 scale. 0–6 are detractors, 7–8 passives, 9–10 promoters.</SettingsNote>
      <div className="fts-pair">
        <TextRow
          label="Label at 0"
          value={field.props.lowLabel}
          maxLength={60}
          onChange={v => onChange({lowLabel: v}, `low:${field.id}`)}
          disabled={readOnly}
        />
        <TextRow
          label="Label at 10"
          value={field.props.highLabel}
          maxLength={60}
          onChange={v => onChange({highLabel: v}, `high:${field.id}`)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
