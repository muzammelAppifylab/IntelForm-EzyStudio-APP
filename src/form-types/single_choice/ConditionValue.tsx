import {OptionValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function SingleChoiceConditionValue(props: ConditionValueProps<'single_choice'>) {
  return <OptionValue {...(props as ConditionValueProps)} options={props.field.props.options} other={props.field.props.other} />;
}
