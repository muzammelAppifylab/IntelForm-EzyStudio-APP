import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function NameConditionValue(props: ConditionValueProps<'name'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
