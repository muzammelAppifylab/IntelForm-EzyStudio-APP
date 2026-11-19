import {RichTextInput} from '../../respondent/rich/LazyRichTextInput';
import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';

export default function ShortTextRenderer({field, value, onChange, inputId, describedBy, invalid, onAdvance, labels}: FieldRendererProps<'short_text'>) {
  if (field.props.richText) {
    return (
      <RichTextInput
        id={inputId}
        inline
        value={value}
        onChange={onChange}
        placeholder={field.placeholder || labels.typeAnswer}
        labelledBy={`${inputId}-label`}
        describedBy={describedBy}
        invalid={invalid}
        required={field.required}
        onAdvance={onAdvance}
        labels={labels}
      />
    );
  }
  return (
    <TextInput
      id={inputId}
      type="text"
      placeholder={field.placeholder || labels.typeAnswer}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      invalid={invalid}
      maxLength={field.props.maxLength ?? 1000}
      value={typeof value === 'string' ? value : ''}
      onValueChange={v => onChange(v === '' ? undefined : v)}
      onAdvance={onAdvance}
    />
  );
}
