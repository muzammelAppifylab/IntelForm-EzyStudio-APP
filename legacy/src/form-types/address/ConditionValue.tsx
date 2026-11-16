import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function AddressConditionValue(props: ConditionValueProps<'address'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
