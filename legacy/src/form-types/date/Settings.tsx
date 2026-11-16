import type { FieldSettingsProps } from '@/builder/type-ui'
import { DATE_FORMATS, type DateFormat } from '@shared/form/types/registry'
import { SelectRow, SwitchRow, TextRow } from '@/builder/controls'

export default function DateSettings({ field, onChange, readOnly }: FieldSettingsProps<'date'>) {
  const p = field.props
  return (
    <div className="grid gap-4">
      <SelectRow<DateFormat> label="Format" value={p.format} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} onChange={(v) => onChange({ format: v })} disabled={readOnly} />
      <div className="grid grid-cols-2 gap-3">
        <TextRow label="Earliest" type="date" value={p.minDate ?? ''} max={p.maxDate ?? undefined} onChange={(v) => onChange({ minDate: v || null })} disabled={readOnly} />
        <TextRow label="Latest" type="date" value={p.maxDate ?? ''} min={p.minDate ?? undefined} onChange={(v) => onChange({ maxDate: v || null })} disabled={readOnly} />
      </div>
      <SwitchRow label="Disable past dates" checked={p.disablePast} onCheckedChange={(v) => onChange({ disablePast: v, ...(v && { disableFuture: false }) })} disabled={readOnly} />
      <SwitchRow label="Disable future dates" checked={p.disableFuture} onCheckedChange={(v) => onChange({ disableFuture: v, ...(v && { disablePast: false }) })} disabled={readOnly} />
    </div>
  )
}
