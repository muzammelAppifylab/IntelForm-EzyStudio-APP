import { useState } from 'react'
import { FORM_FONT } from '@/components/ds/tokens'
import { clsx } from 'clsx'
import type { FieldRendererProps } from '@/respondent/types'
import { TextInput } from '@/respondent/ui'

const NUMBER_RE = /^-?(\d+([.,]\d*)?|[.,]\d+)$/

/** Number with optional prefix / suffix. Text is kept as typed; the answer is a number. */
export default function NumberRenderer({ field, value, onChange, inputId, describedBy, invalid, onAdvance, labels }: FieldRendererProps<'number'>) {
  const [text, setText] = useState(() => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''))
  const { prefix, suffix, allowDecimals, min } = field.props
  const update = (raw: string) => {
    setText(raw)
    const t = raw.trim()
    if (t === '') onChange(undefined, { invalid: null })
    else if (NUMBER_RE.test(t)) onChange(Number(t.replace(',', '.')), { invalid: null })
    else onChange(undefined, { invalid: 'invalidNumber' })
  }
  return (
    <div className="flex items-center gap-2">
      {prefix && (
        <span aria-hidden className={clsx('text-answer text-muted-foreground', FORM_FONT)}>
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
        className="max-w-60 tabular-nums"
      />
      {suffix && (
        <span aria-hidden className={clsx('text-answer text-muted-foreground', FORM_FONT)}>
          {suffix}
        </span>
      )}
      {(prefix || suffix) && <span className="sr-only">{[prefix, suffix].filter(Boolean).join(' ')}</span>}
    </div>
  )
}
