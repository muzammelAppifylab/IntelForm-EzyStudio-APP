import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function PhoneConditionValue(props: ConditionValueProps<'phone'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
