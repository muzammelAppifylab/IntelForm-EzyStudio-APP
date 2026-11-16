import type {FieldRendererProps} from '../../respondent/types';
import {ChoiceGroup} from '../_respondent/choice';

/** Two radios side by side; the answer is a boolean. */
export default function YesNoRenderer(p: FieldRendererProps<'yes_no'>) {
  const {field, value, onChange, labels} = p;
  return (
    <ChoiceGroup
      type="radio"
      name={p.inputId}
      legend={p.legend}
      legendClassName={p.large ? 'rf-question-xl' : undefined}
      description={p.description}
      orientation="horizontal"
      options={[
        {value: 'yes', label: field.props.yesLabel || labels.yes},
        {value: 'no', label: field.props.noLabel || labels.no},
      ]}
      required={field.required}
      error={p.error}
      value={value === true ? 'yes' : value === false ? 'no' : null}
      onChange={v => onChange(v === 'yes')}
      className="ft-yes-no"
    />
  );
}
