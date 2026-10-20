import { useMemo, useState } from 'react'
import { OTHER_OPTION_ID } from '@shared/form/base'
import { formatLabel } from '@shared/form/labels'
import { ChoiceGroup, OTHER_VALUE } from '@/components/ds/ChoiceOption'
import type { FieldRendererProps } from '@/respondent/types'
import { shuffled } from '@/respondent/util'

interface ChoiceAnswer {
  option: string
  other?: string
}

/** Checkboxes in a fieldset (ds ChoiceGroup); arrow keys move between them. Never auto-advances. */
export default function MultipleChoiceRenderer(p: FieldRendererProps<'multiple_choice'>) {
  const { field, value, onChange, labels } = p
  const [seed] = useState(() => Math.floor(Math.random() * 1e9))
  const options = useMemo(
    () => (field.props.randomize ? shuffled(field.props.options, seed) : field.props.options).map((o) => ({ value: o.id, label: o.label })),
    [field.props.options, field.props.randomize, seed],
  )
  const answers = (Array.isArray(value) ? value : []) as ChoiceAnswer[]
  const [otherText, setOtherText] = useState(answers.find((a) => a.option === OTHER_OPTION_ID)?.other ?? '')
  const selected = answers.map((a) => (a.option === OTHER_OPTION_ID ? OTHER_VALUE : a.option))
  const emit = (values: string[], other = otherText) => {
    const next = values.map((v) => (v === OTHER_VALUE ? { option: OTHER_OPTION_ID, other } : { option: v }))
    onChange(next.length ? next : undefined)
  }
  const { minSelections: min, maxSelections: max } = field.props
  const hint = [min && formatLabel(labels.chooseAtLeast, { n: min }), max && formatLabel(labels.chooseAtMost, { n: max })].filter(Boolean).join(', ')
  return (
    <ChoiceGroup
      type="checkbox"
      name={p.inputId}
      legend={p.legend}
      legendClassName={p.large ? 'text-question-xl' : undefined}
      description={[p.description, hint].filter(Boolean).join(' · ') || undefined}
      options={options}
      orientation={field.props.orientation}
      required={field.required}
      error={p.error}
      value={selected}
      onChange={(values) => emit(values)}
      other={
        field.props.other
          ? {
              label: labels.other,
              placeholder: labels.otherPlaceholder,
              text: otherText,
              onTextChange: (t) => {
                setOtherText(t)
                emit(selected, t)
              },
            }
          : undefined
      }
    />
  )
}
