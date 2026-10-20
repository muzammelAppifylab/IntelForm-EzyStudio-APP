import type { ConditionValueProps } from '@/builder/type-ui'
import { TimeValue } from '@/builder/condition-inputs'

export default function TimeConditionValue(props: ConditionValueProps<'time'>) {
  return <TimeValue {...(props as ConditionValueProps)} />
}
