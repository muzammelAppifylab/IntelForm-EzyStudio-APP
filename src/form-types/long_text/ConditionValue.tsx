import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function LongTextConditionValue(props: ConditionValueProps<'long_text'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
