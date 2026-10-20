import { useId, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { Slot } from 'radix-ui'
import { FieldError } from '@/components/ds/FieldError'
import { formButtonClass, inputClass, type ButtonVariant } from './classes'
import { CONTROL, enterToAdvance } from './util'

/**
 * Small respondent-side primitives shared by the field renderers and the layouts. They follow
 * the form theme through the design-system tokens that themeToVars() sets on `.form-theme`.
 * They render native elements with the class lists in ./classes (no ui/Input, ui/Button: those
 * merge classes with tailwind-merge, which the form bundle leaves out).
 */

type TextInputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string
  onValueChange: (v: string) => void
  onAdvance?: () => void
  invalid?: boolean
}

/** Themed single-line input with the Enter rule wired in. */
export function TextInput({ value, onValueChange, onAdvance, invalid, className, onKeyDown, ...rest }: TextInputProps) {
  return (
    <input
      data-slot="input"
      {...rest}
      value={value}
      aria-invalid={invalid || undefined}
      enterKeyHint={rest.enterKeyHint ?? (onAdvance ? 'next' : undefined)}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented) enterToAdvance(e, onAdvance)
      }}
      className={inputClass(className)}
    />
  )
}

/** Themed native select (time, address country, plain dropdown). */
export function NativeSelect({ className, invalid, ...rest }: ComponentProps<'select'> & { invalid?: boolean }) {
  return (
    <span className={clsx('relative block min-w-0', className)}>
      {/* No pr-10: CONTROL's px-4 always won the merge, so the select keeps 16px on both sides. */}
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={clsx(
          'focus-ring w-full min-w-0 cursor-pointer appearance-none border border-input bg-field text-foreground aria-invalid:border-destructive',
          CONTROL,
        )}
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

/**
 * Fieldset + legend for group-type fields that don't use a ds component (name, address, time,
 * consent, signature, picture choice). The legend holds the question heading.
 */
export function Group({
  legend,
  description,
  error,
  required,
  children,
  className,
  legendClassName,
}: {
  legend: ReactNode
  description?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
  /** The legend's type class (default `text-question`), e.g. `text-question-xl`. */
  legendClassName?: string
}) {
  const id = useId()
  const descId = description ? `${id}-d` : undefined
  const errId = error ? `${id}-e` : undefined
  return (
    <fieldset
      aria-describedby={[descId, errId].filter(Boolean).join(' ') || undefined}
      className={clsx('m-0 grid min-w-0 gap-3 border-0 p-0', className)}
    >
      <legend className={clsx('mb-3 p-0 text-foreground', legendClassName ?? 'text-question')}>
        {legend}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      {description && (
        <p id={descId} className="-mt-2 text-body text-muted-foreground whitespace-pre-line">
          {description}
        </p>
      )}
      {children}
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  )
}

/** Small caption label above a sub-input (first name, city…). */
export function SubLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-label text-muted-foreground">
      {children}
    </label>
  )
}

/** Themed respondent button: 48px, the theme's button colour and corner shape. */
export function FormButton({
  className,
  variant = 'default',
  asChild = false,
  ...rest
}: ComponentProps<'button'> & { variant?: ButtonVariant; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp data-slot="button" data-variant={variant} data-size="lg" className={formButtonClass(variant, className)} {...rest} />
}

