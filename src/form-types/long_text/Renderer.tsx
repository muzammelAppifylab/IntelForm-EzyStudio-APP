import { clsx } from 'clsx'
import { FIELD, FORM_FONT, FORM_RADIUS } from '@/components/ds/tokens'
import type { FieldRendererProps } from '@/respondent/types'

/** Shift+Enter (and plain Enter) is a newline; Cmd/Ctrl+Enter advances. */
export default function LongTextRenderer({ field, value, onChange, inputId, describedBy, invalid, onAdvance, labels }: FieldRendererProps<'long_text'>) {
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
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      onKeyDown={(e) => {
        if (onAdvance && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onAdvance()
        }
      }}
      style={{ minHeight: `${field.props.rows * 1.5 + 1.5}rem` }}
      className={clsx(FIELD, 'flex field-sizing-content min-h-24 px-4 py-3 text-answer', FORM_FONT, FORM_RADIUS)}
    />
  )
}
