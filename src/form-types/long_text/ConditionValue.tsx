import {TextValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function LongTextConditionValue(props: ConditionValueProps<'long_text'>) {
  return <TextValue {...(props as ConditionValueProps)} />;
}
