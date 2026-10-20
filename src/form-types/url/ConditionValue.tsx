import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

export default function UrlConditionValue(props: ConditionValueProps<'url'>) {
  return <TextValue {...(props as ConditionValueProps)} />
}
