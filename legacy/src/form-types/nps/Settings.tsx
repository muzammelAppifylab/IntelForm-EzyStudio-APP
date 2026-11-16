import type { FieldSettingsProps } from '@/builder/type-ui'
import { TextRow } from '@/builder/controls'

export default function NpsSettings({ field, onChange, readOnly }: FieldSettingsProps<'nps'>) {
  return (
    <div className="grid gap-3">
      <p className="text-caption text-muted-foreground">A fixed 0 to 10 scale. 0–6 are detractors, 7–8 passives, 9–10 promoters.</p>
      <div className="grid grid-cols-2 gap-3">
        <TextRow label="Label at 0" value={field.props.lowLabel} maxLength={60} onChange={(v) => onChange({ lowLabel: v }, `low:${field.id}`)} disabled={readOnly} />
        <TextRow label="Label at 10" value={field.props.highLabel} maxLength={60} onChange={(v) => onChange({ highLabel: v }, `high:${field.id}`)} disabled={readOnly} />
      </div>
    </div>
  )
}
