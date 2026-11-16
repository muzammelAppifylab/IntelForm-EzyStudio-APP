import {ScaleValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function RatingConditionValue(props: ConditionValueProps<'rating'>) {
  return <ScaleValue {...(props as ConditionValueProps)} from={1} to={props.field.props.scale} />;
}
