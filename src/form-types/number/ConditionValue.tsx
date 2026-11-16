import {NumberValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function NumberConditionValue(props: ConditionValueProps<'number'>) {
  return <NumberValue {...(props as ConditionValueProps)} />;
}
