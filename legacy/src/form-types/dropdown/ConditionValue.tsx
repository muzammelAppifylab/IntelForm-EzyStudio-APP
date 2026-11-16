import type { ConditionValueProps } from '@/builder/type-ui'
import { OptionValue } from '@/builder/condition-inputs'

export default function DropdownConditionValue(props: ConditionValueProps<'dropdown'>) {
  return <OptionValue {...(props as ConditionValueProps)} options={props.field.props.options} other={false} />
}
