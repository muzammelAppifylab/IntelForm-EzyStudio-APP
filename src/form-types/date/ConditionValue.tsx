import type { ConditionValueProps } from '@/builder/type-ui'
import { DateValue } from '@/builder/condition-inputs'

export default function DateConditionValue(props: ConditionValueProps<'date'>) {
  return <DateValue {...(props as ConditionValueProps)} />
}
