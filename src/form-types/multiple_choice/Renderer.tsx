import {useMemo, useState} from 'react';

import {formatLabel} from '../../lib/intelform/form/labels';
import {escapeHtml} from '../../lib/intelform/form/rich-text';
import type {FieldRendererProps} from '../../respondent/types';
import {shuffled} from '../../respondent/util';
import {ChoiceGroup} from '../_respondent/choice';
import {multipleChoiceAnswer, selectedValues} from './answer';

/** Checkboxes in a fieldset; arrow keys move between them. Never auto-advances. */
export default function MultipleChoiceRenderer(p: FieldRendererProps<'multiple_choice'>) {
  const {field, value, onChange, labels} = p;
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const options = useMemo(
    () => (field.props.randomize ? shuffled(field.props.options, seed) : field.props.options).map(o => ({value: o.id, label: o.label})),
    [field.props.options, field.props.randomize, seed]
  );
  const {selected, otherText: initialOther} = selectedValues(value);
  const [otherText, setOtherText] = useState(initialOther);
  const emit = (values: string[], other = otherText) => onChange(multipleChoiceAnswer(values, other));
  const {minSelections: min, maxSelections: max} = field.props;
  const hint = [min && formatLabel(labels.chooseAtLeast, {n: min}), max && formatLabel(labels.chooseAtMost, {n: max})].filter(Boolean).join(', ');
  return (
    <ChoiceGroup
      type="checkbox"
      name={p.inputId}
      legend={p.legend}
      legendClassName={p.large ? 'rf-question-xl' : undefined}
      description={[p.description, hint && `<p>${escapeHtml(hint)}</p>`].filter(Boolean).join('') || undefined}
      options={options}
      orientation={field.props.orientation}
      required={field.required}
      error={p.error}
      value={selected}
      onChange={values => emit(values)}
      other={
        field.props.other
          ? {
              label: labels.other,
              placeholder: labels.otherPlaceholder,
              text: otherText,
              onTextChange: t => {
                setOtherText(t);
                emit(selected, t);
              },
            }
          : undefined
      }
    />
  );
}
