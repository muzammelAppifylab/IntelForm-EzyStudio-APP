import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function EmailConditionValue(props: ConditionValueProps<'email'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
