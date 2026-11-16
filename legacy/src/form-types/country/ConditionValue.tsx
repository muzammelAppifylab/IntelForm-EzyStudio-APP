import type { ConditionValueProps } from '@/builder/type-ui'
import { CountryValue } from '@/builder/condition-inputs'

export default function CountryConditionValue(props: ConditionValueProps<'country'>) {
  return <CountryValue {...(props as ConditionValueProps)} limitTo={props.field.props.limitTo} />
}
