import {TextValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function NameConditionValue(props: ConditionValueProps<'name'>) {
  return <TextValue {...(props as ConditionValueProps)} />;
}
