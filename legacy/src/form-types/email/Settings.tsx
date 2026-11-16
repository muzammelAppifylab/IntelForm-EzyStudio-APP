import type { FieldSettingsProps } from '@/builder/type-ui'
import { SwitchRow } from '@/builder/controls'

/** Email: optionally refuse free providers (gmail.com…); the server checks the full list. */
export default function EmailSettings({ field, onChange, readOnly }: FieldSettingsProps<'email'>) {
  return (
    <SwitchRow
      label="Block free email domains"
      description="Ask for a work address: Gmail, Outlook, Yahoo and similar are refused."
      checked={field.props.blockFreeDomains}
      onCheckedChange={(v) => onChange({ blockFreeDomains: v })}
      disabled={readOnly}
    />
  )
}
