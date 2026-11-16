import type { FieldSettingsProps } from '@/builder/type-ui'
import { SegmentRow, SwitchRow } from '@/builder/controls'
import { OptionsEditor } from '@/builder/OptionsEditor'

export default function SingleChoiceSettings({ field, onChange, readOnly }: FieldSettingsProps<'single_choice'>) {
  const p = field.props
  return (
    <div className="grid gap-4">
      <OptionsEditor fieldName={field.label || 'this question'} options={p.options} onChange={(options, key) => onChange({ options }, key)} readOnly={readOnly} />
      <SwitchRow label="“Other” option" description="Adds an option with a text box." checked={p.other} onCheckedChange={(v) => onChange({ other: v })} disabled={readOnly} />
      <SwitchRow label="Randomize order" description="Each respondent sees the options shuffled." checked={p.randomize} onCheckedChange={(v) => onChange({ randomize: v })} disabled={readOnly} />
      <SegmentRow
        label="Direction"
        value={p.orientation}
        options={[
          { value: 'vertical', label: 'Vertical' },
          { value: 'horizontal', label: 'Horizontal' },
        ]}
        onChange={(v) => onChange({ orientation: v })}
        disabled={readOnly}
      />
    </div>
  )
}
