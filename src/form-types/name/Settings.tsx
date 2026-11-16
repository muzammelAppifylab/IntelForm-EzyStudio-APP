import {SegmentRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

export default function NameSettings({field, onChange, readOnly}: FieldSettingsProps<'name'>) {
  return (
    <SegmentRow
      label="Boxes"
      value={field.props.split ? 'split' : 'single'}
      options={[
        {value: 'single', label: 'One box'},
        {value: 'split', label: 'First and last'},
      ]}
      onChange={v => onChange({split: v === 'split'})}
      disabled={readOnly}
      description={field.props.split ? 'Answers can be piped as first or last name.' : undefined}
    />
  );
}
