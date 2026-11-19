import {SwitchRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {LengthLimits} from '../_settings/LengthLimits';

export default function ShortTextSettings({field, onChange, readOnly}: FieldSettingsProps<'short_text'>) {
  return (
    <div className="fts-stack">
      <SwitchRow
        label="Rich text answers"
        description="Respondents get a formatting toolbar: bold, italic, underline, strikethrough and links, on one line. Exports and emails show the text without formatting."
        checked={field.props.richText}
        disabled={readOnly}
        onCheckedChange={v => onChange({richText: v})}
      />
      <LengthLimits min={field.props.minLength} max={field.props.maxLength} cap={1000} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
