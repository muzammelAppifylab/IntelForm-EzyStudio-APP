import {TextRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function YesNoSettings({field, onChange, readOnly}: FieldSettingsProps<'yes_no'>) {
  return (
    <div className="fts-pair">
      <TextRow label="Yes label" value={field.props.yesLabel} maxLength={40} onChange={v => onChange({yesLabel: v}, `yes:${field.id}`)} disabled={readOnly} />
      <TextRow label="No label" value={field.props.noLabel} maxLength={40} onChange={v => onChange({noLabel: v}, `no:${field.id}`)} disabled={readOnly} />
    </div>
  );
}
