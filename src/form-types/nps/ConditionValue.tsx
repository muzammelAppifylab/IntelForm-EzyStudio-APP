import {ScaleValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function NpsConditionValue(props: ConditionValueProps<'nps'>) {
  return <ScaleValue {...(props as ConditionValueProps)} from={0} to={10} />;
}
