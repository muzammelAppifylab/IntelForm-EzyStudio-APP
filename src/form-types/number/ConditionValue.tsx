import type { ConditionValueProps } from '@/builder/type-ui'
import { NumberValue } from '@/builder/condition-inputs'

export default function NumberConditionValue(props: ConditionValueProps<'number'>) {
  return <NumberValue {...(props as ConditionValueProps)} />
}
