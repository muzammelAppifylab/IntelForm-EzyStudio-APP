import type { FieldSettingsProps } from '@/builder/type-ui'
import { NumberRow } from '@/builder/controls'

export default function ShortTextSettings({ field, onChange, readOnly }: FieldSettingsProps<'short_text'>) {
  return <LengthLimits min={field.props.minLength} max={field.props.maxLength} cap={1000} onChange={onChange} readOnly={readOnly} />
}

function LengthLimits({ min, max, cap, onChange, readOnly }: { min: number | null; max: number | null; cap: number; onChange(p: { minLength?: number | null; maxLength?: number | null }): void; readOnly: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberRow label="Min characters" value={min} min={0} max={max ?? cap} onChange={(v) => onChange({ minLength: v })} disabled={readOnly} placeholder="None" />
      <NumberRow label="Max characters" value={max} min={Math.max(1, min ?? 0)} max={cap} onChange={(v) => onChange({ maxLength: v })} disabled={readOnly} placeholder={String(cap)} />
    </div>
  )
}
