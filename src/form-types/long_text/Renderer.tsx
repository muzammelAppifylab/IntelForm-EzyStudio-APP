import {inputClass} from '../../respondent/classes';
import {RichTextInput} from '../../respondent/rich/LazyRichTextInput';
import type {FieldRendererProps} from '../../respondent/types';

/**
 * Enter (and Shift+Enter) is a newline; Cmd/Ctrl+Enter advances. The box height follows the
 * `rows` setting (the `rows` attribute; no inline style, the page's CSP refuses those) and grows
 * with the text where the browser supports `field-sizing`. With "Rich text answers" on, a
 * formatting box instead (the answer is `{html}`).
 */
export default function LongTextRenderer({field, value, onChange, inputId, describedBy, invalid, onAdvance, labels}: FieldRendererProps<'long_text'>) {
  if (field.props.richText) {
    return (
      <RichTextInput
        id={inputId}
        value={value}
        onChange={onChange}
        rows={field.props.rows}
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
    <textarea
      data-slot="textarea"
      id={inputId}
      rows={field.props.rows}
      placeholder={field.placeholder || labels.typeAnswer}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      aria-invalid={invalid || undefined}
      maxLength={field.props.maxLength ?? 10000}
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
      onKeyDown={e => {
        if (onAdvance && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onAdvance();
        }
      }}
      className={inputClass('ft-textarea')}
    />
  );
}
