import type { ConditionValueProps } from '@/builder/type-ui'
import { ScaleValue } from '@/builder/condition-inputs'

export default function NpsConditionValue(props: ConditionValueProps<'nps'>) {
  return <ScaleValue {...(props as ConditionValueProps)} from={0} to={10} />
}
