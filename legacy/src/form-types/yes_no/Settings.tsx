import type { FieldSettingsProps } from '@/builder/type-ui'
import { TextRow } from '@/builder/controls'

export default function YesNoSettings({ field, onChange, readOnly }: FieldSettingsProps<'yes_no'>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextRow label="Yes label" value={field.props.yesLabel} maxLength={40} onChange={(v) => onChange({ yesLabel: v }, `yes:${field.id}`)} disabled={readOnly} />
      <TextRow label="No label" value={field.props.noLabel} maxLength={40} onChange={(v) => onChange({ noLabel: v }, `no:${field.id}`)} disabled={readOnly} />
    </div>
  )
}
