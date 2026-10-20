import type { ConditionValueProps } from '@/builder/type-ui'
import { ScaleValue } from '@/builder/condition-inputs'

export default function RatingConditionValue(props: ConditionValueProps<'rating'>) {
  return <ScaleValue {...(props as ConditionValueProps)} from={1} to={props.field.props.scale} />
}
