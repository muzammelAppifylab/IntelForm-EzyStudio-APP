import type { FieldSettingsProps } from '@/builder/type-ui'
import { NumberRow, SelectRow } from '@/builder/controls'

const ROWS = ['2', '3', '4', '5', '6', '8', '10', '12', '16', '20'] as const

export default function LongTextSettings({ field, onChange, readOnly }: FieldSettingsProps<'long_text'>) {
  return (
    <div className="grid gap-4">
      <LengthLimits min={field.props.minLength} max={field.props.maxLength} cap={10000} onChange={onChange} readOnly={readOnly} />
      <SelectRow
        label="Box height"
        value={String(field.props.rows) as (typeof ROWS)[number]}
        options={ROWS.map((r) => ({ value: r, label: `${r} lines` }))}
        onChange={(v) => onChange({ rows: Number(v) })}
        disabled={readOnly}
      />
    </div>
  )
}

function LengthLimits({ min, max, cap, onChange, readOnly }: { min: number | null; max: number | null; cap: number; onChange(p: { minLength?: number | null; maxLength?: number | null }): void; readOnly: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberRow label="Min characters" value={min} min={0} max={max ?? cap} onChange={(v) => onChange({ minLength: v })} disabled={readOnly} placeholder="None" />
      <NumberRow label="Max characters" value={max} min={Math.max(1, min ?? 0)} max={cap} onChange={(v) => onChange({ maxLength: v })} disabled={readOnly} placeholder={String(cap)} />
    </div>
  )
}
