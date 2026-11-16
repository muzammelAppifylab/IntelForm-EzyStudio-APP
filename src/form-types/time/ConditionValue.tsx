import {TimeValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function TimeConditionValue(props: ConditionValueProps<'time'>) {
  return <TimeValue {...(props as ConditionValueProps)} />;
}
