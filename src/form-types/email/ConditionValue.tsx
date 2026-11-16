import {TextValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function EmailConditionValue(props: ConditionValueProps<'email'>) {
  return <TextValue {...(props as ConditionValueProps)} />;
}
