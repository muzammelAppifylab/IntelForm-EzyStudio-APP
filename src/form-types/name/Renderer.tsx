import type {FieldRendererProps} from '../../respondent/types';
import {Group, SubLabel, TextInput} from '../../respondent/ui';

interface NameValue {
  first?: string;
  last?: string;
}

/** The next split-name answer after typing into one part; undefined when both are empty. */
export function nextNameValue(current: NameValue, part: 'first' | 'last', text: string): {first: string; last: string} | undefined {
  const next = {first: current.first ?? '', last: current.last ?? '', [part]: text};
  return next.first === '' && next.last === '' ? undefined : next;
}

/** One box (a string) or first + last ({first, last}). */
export default function NameRenderer(p: FieldRendererProps<'name'>) {
  const {field, value, onChange, inputId, describedBy, invalid, onAdvance, labels} = p;
  if (!field.props.split) {
    return (
      <TextInput
        id={inputId}
        autoComplete="name"
        autoCapitalize="words"
        placeholder={field.placeholder || labels.typeAnswer}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        invalid={invalid}
        value={typeof value === 'string' ? value : ''}
        onValueChange={v => onChange(v === '' ? undefined : v)}
        onAdvance={onAdvance}
      />
    );
  }
  const v = (value && typeof value === 'object' ? value : {}) as NameValue;
  const set = (part: 'first' | 'last', text: string) => onChange(nextNameValue(v, part, text));
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'rf-question-xl' : undefined}>
      <div className="ft-pair-grid">
        <div className="ft-sub-field">
          <SubLabel htmlFor={inputId}>{labels.firstName}</SubLabel>
          <TextInput
            id={inputId}
            autoComplete="given-name"
            autoCapitalize="words"
            aria-required={field.required || undefined}
            invalid={invalid}
            value={v.first ?? ''}
            onValueChange={t => set('first', t)}
            onAdvance={onAdvance}
          />
        </div>
        <div className="ft-sub-field">
          <SubLabel htmlFor={`${inputId}-last`}>{labels.lastName}</SubLabel>
          <TextInput
            id={`${inputId}-last`}
            autoComplete="family-name"
            autoCapitalize="words"
            invalid={invalid}
            value={v.last ?? ''}
            onValueChange={t => set('last', t)}
            onAdvance={onAdvance}
          />
        </div>
      </div>
    </Group>
  );
}
