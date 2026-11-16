import { useMemo, useState } from 'react'
import { OTHER_OPTION_ID } from '@shared/form/base'
import { ChoiceGroup, OTHER_VALUE } from '@/components/ds/ChoiceOption'
import type { FieldRendererProps } from '@/respondent/types'
import { shuffled } from '@/respondent/util'

interface ChoiceAnswer {
  option: string
  other?: string
}

/** Native radios in a fieldset (ds ChoiceGroup), with letter keys inside the group and "Other". */
export default function SingleChoiceRenderer(p: FieldRendererProps<'single_choice'>) {
  const { field, value, onChange, labels } = p
  const [seed] = useState(() => Math.floor(Math.random() * 1e9))
  const options = useMemo(
    () => (field.props.randomize ? shuffled(field.props.options, seed) : field.props.options).map((o) => ({ value: o.id, label: o.label })),
    [field.props.options, field.props.randomize, seed],
  )
  const answer = (value && typeof value === 'object' ? value : null) as ChoiceAnswer | null
  const [otherText, setOtherText] = useState(answer?.other ?? '')
  const selected = answer ? (answer.option === OTHER_OPTION_ID ? OTHER_VALUE : answer.option) : null
  return (
    <ChoiceGroup
      type="radio"
      name={p.inputId}
      legend={p.legend}
      legendClassName={p.large ? 'text-question-xl' : undefined}
      description={p.description}
      options={options}
      orientation={field.props.orientation}
      required={field.required}
      error={p.error}
      value={selected}
      onChange={(v) => onChange(v === OTHER_VALUE ? { option: OTHER_OPTION_ID, other: otherText } : { option: v })}
      other={
        field.props.other
          ? {
              label: labels.other,
              placeholder: labels.otherPlaceholder,
              text: otherText,
              onTextChange: (t) => {
                setOtherText(t)
                onChange({ option: OTHER_OPTION_ID, other: t })
              },
            }
          : undefined
      }
    />
  )
}
