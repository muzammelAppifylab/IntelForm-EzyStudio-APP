import type { FieldSettingsProps } from '@/builder/type-ui'
import { SwitchRow } from '@/builder/controls'
import { OptionsEditor } from '@/builder/OptionsEditor'

export default function DropdownSettings({ field, onChange, readOnly }: FieldSettingsProps<'dropdown'>) {
  const p = field.props
  return (
    <div className="grid gap-4">
      <OptionsEditor fieldName={field.label || 'this question'} options={p.options} onChange={(options, key) => onChange({ options }, key)} readOnly={readOnly} />
      <SwitchRow label="Searchable" description="Respondents can type to filter long lists." checked={p.searchable} onCheckedChange={(v) => onChange({ searchable: v })} disabled={readOnly} />
      <SwitchRow label="Randomize order" checked={p.randomize} onCheckedChange={(v) => onChange({ randomize: v })} disabled={readOnly} />
    </div>
  )
}
