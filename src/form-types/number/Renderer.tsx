import {useState} from 'react';

import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';
import {parseNumberText} from './parse';

/** Number with optional prefix / suffix. Text is kept as typed; the answer is a number. */
export default function NumberRenderer({field, value, onChange, inputId, describedBy, invalid, onAdvance, labels}: FieldRendererProps<'number'>) {
  const [text, setText] = useState(() => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''));
  const {prefix, suffix, allowDecimals, min} = field.props;
  const update = (raw: string) => {
    setText(raw);
    const parsed = parseNumberText(raw);
    if (parsed.kind === 'empty') onChange(undefined, {invalid: null});
    else if (parsed.kind === 'number') onChange(parsed.value, {invalid: null});
    else onChange(undefined, {invalid: 'invalidNumber'});
  };
  return (
    <div className="ft-affix-row">
      {prefix && (
        <span aria-hidden className="ft-affix">
          {prefix}
        </span>
      )}
      <TextInput
        id={inputId}
        type="text"
        inputMode={allowDecimals ? 'decimal' : min !== null && min >= 0 ? 'numeric' : 'text'}
        placeholder={field.placeholder || labels.typeAnswer}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        invalid={invalid}
        value={text}
        onValueChange={update}
        onAdvance={onAdvance}
        className="ft-number-input"
      />
      {suffix && (
        <span aria-hidden className="ft-affix">
          {suffix}
        </span>
      )}
      {(prefix || suffix) && <span className="ft-sr-only">{[prefix, suffix].filter(Boolean).join(' ')}</span>}
    </div>
  );
}
