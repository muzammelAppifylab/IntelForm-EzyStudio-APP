import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function ShortTextConditionValue(props: ConditionValueProps<'short_text'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
