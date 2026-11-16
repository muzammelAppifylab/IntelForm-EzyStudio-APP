import type { FieldSettingsProps } from '@/builder/type-ui'
import { SegmentRow, SelectRow } from '@/builder/controls'

const STEPS = ['1', '5', '10', '15', '30', '60'] as const

export default function TimeSettings({ field, onChange, readOnly }: FieldSettingsProps<'time'>) {
  return (
    <div className="grid gap-4">
      <SegmentRow
        label="Clock"
        value={field.props.hourCycle}
        options={[
          { value: '24', label: '24 hour' },
          { value: '12', label: '12 hour' },
        ]}
        onChange={(v) => onChange({ hourCycle: v })}
        disabled={readOnly}
      />
      <SelectRow
        label="Step"
        value={(STEPS as readonly string[]).includes(String(field.props.step)) ? (String(field.props.step) as (typeof STEPS)[number]) : null}
        options={STEPS.map((s) => ({ value: s, label: s === '1' ? 'Any minute' : `Every ${s} minutes` }))}
        onChange={(v) => onChange({ step: Number(v) })}
        disabled={readOnly}
      />
    </div>
  )
}
