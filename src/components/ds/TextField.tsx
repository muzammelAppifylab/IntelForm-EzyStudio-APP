import type { ComponentProps } from 'react'
import { Field } from '@/components/common/Field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/components/ui/cn'
import { FORM_FONT } from './tokens'

interface TextFieldBase {
  label: string
  description?: string
  error?: string
  required?: boolean
  /** `md` (40px) in the dashboard; `lg` (48px, `answer` text) on respondent forms. */
  size?: 'md' | 'lg'
  className?: string
}

type InputOnly = Omit<ComponentProps<typeof Input>, 'size' | 'id' | 'aria-invalid' | 'aria-describedby' | 'required'>
type TextareaOnly = Omit<ComponentProps<typeof Textarea>, 'id' | 'aria-invalid' | 'aria-describedby' | 'required'>

export type TextFieldProps = TextFieldBase &
  ((InputOnly & { multiline?: false }) | (TextareaOnly & { multiline: true }))

/**
 * Labelled text input (Field + Input): label with a `destructive` asterisk when required,
 * help text, and an error that sets aria-invalid and aria-describedby. `multiline` renders a
 * textarea. Never use the placeholder as the label.
 */
export function TextField(props: TextFieldProps) {
  const { label, description, error, required, size = 'md', className } = props
  const lg = size === 'lg'
  return (
    <Field label={label} description={description} error={error} required={required}>
      {(control) => {
        if (props.multiline) {
          const { label: _l, description: _d, error: _e, required: _r, size: _s, className: _c, multiline: _m, ...rest } = props
          return (
            <Textarea
              {...rest}
              {...control}
              required={required}
              className={cn(lg && cn('min-h-32 px-4 py-3 text-answer', FORM_FONT), className)}
            />
          )
        }
        const { label: _l, description: _d, error: _e, required: _r, size: _s, className: _c, multiline: _m, ...rest } = props
        return (
          <Input
            {...rest}
            {...control}
            required={required}
            className={cn(lg && cn('h-(--control-lg) px-4 text-answer', FORM_FONT), className)}
          />
        )
      }}
    </Field>
  )
}
