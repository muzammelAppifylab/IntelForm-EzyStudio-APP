import {TextValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function ShortTextConditionValue(props: ConditionValueProps<'short_text'>) {
  return <TextValue {...(props as ConditionValueProps)} />;
}
