import {OptionValue} from '../../portal/intelform/builder/condition-inputs';
import type {ConditionValueProps} from '../../portal/intelform/builder/type-ui';

export default function DropdownConditionValue(props: ConditionValueProps<'dropdown'>) {
  return <OptionValue {...(props as ConditionValueProps)} options={props.field.props.options} other={false} />;
}
