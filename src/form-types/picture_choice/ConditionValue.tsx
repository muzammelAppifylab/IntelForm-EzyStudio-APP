import type { ConditionValueProps } from '@/builder/type-ui'
import { OptionValue } from '@/builder/condition-inputs'

export default function PictureChoiceConditionValue(props: ConditionValueProps<'picture_choice'>) {
  return <OptionValue {...(props as ConditionValueProps)} options={props.field.props.options} other={false} />
}
