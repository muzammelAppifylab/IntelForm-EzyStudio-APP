import {CountryValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function CountryConditionValue(props: ConditionValueProps<'country'>) {
  return <CountryValue {...(props as ConditionValueProps)} limitTo={props.field.props.limitTo} />;
}
