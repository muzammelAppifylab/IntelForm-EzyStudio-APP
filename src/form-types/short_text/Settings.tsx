import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {LengthLimits} from '../_settings/LengthLimits';

export default function ShortTextSettings({field, onChange, readOnly}: FieldSettingsProps<'short_text'>) {
  return <LengthLimits min={field.props.minLength} max={field.props.maxLength} cap={1000} onChange={onChange} readOnly={readOnly} />;
}
