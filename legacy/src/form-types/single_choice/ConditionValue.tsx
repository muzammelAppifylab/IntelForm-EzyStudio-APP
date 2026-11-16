import type { ConditionValueProps } from '@/builder/type-ui'
import { OptionValue } from '@/builder/condition-inputs'

export default function SingleChoiceConditionValue(props: ConditionValueProps<'single_choice'>) {
  return <OptionValue {...(props as ConditionValueProps)} options={props.field.props.options} other={props.field.props.other} />
}
