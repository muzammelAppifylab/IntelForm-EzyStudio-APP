import {DateValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function DateConditionValue(props: ConditionValueProps<'date'>) {
  return <DateValue {...(props as ConditionValueProps)} />;
}
