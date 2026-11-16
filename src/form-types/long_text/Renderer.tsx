import {inputClass} from '../../respondent/classes';
import type {FieldRendererProps} from '../../respondent/types';

/**
 * Enter (and Shift+Enter) is a newline; Cmd/Ctrl+Enter advances. The box height follows the
 * `rows` setting (the `rows` attribute; no inline style, the page's CSP refuses those) and grows
 * with the text where the browser supports `field-sizing`.
 */
export default function LongTextRenderer({field, value, onChange, inputId, describedBy, invalid, onAdvance, labels}: FieldRendererProps<'long_text'>) {
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
