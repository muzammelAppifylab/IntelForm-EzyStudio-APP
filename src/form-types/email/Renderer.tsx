import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';

export default function EmailRenderer({field, value, onChange, inputId, describedBy, invalid, onAdvance, labels}: FieldRendererProps<'email'>) {
  return (
    <TextInput
      id={inputId}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      spellCheck={false}
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
