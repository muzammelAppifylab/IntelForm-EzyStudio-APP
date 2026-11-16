import {SwitchRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';

/** Email: optionally refuse free providers (gmail.com…); the server checks the full list. */
export default function EmailSettings({field, onChange, readOnly}: FieldSettingsProps<'email'>) {
  return (
    <SwitchRow
      label="Block free email domains"
      description="Ask for a work address: Gmail, Outlook, Yahoo and similar are refused."
      checked={field.props.blockFreeDomains}
      onCheckedChange={v => onChange({blockFreeDomains: v})}
      disabled={readOnly}
    />
  );
}
