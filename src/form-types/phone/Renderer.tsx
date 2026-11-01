import { lazy, Suspense, useRef } from 'react'
import type { FieldRendererProps } from '@/respondent/types'
import { TextInput } from '@/respondent/ui'

const PhoneInput = lazy(() => import('@/respondent/lazy/PhoneInput'))

/** The phone input loads with libphonenumber on demand; a plain tel input stands in meanwhile. */
export default function PhoneRenderer(props: FieldRendererProps<'phone'>) {
  const { field, value, onChange, inputId, describedBy, invalid, onAdvance } = props
  // Unmounting the focused stand-in drops focus to <body>; the real input takes it back on mount.
  const hadFocus = useRef(false)
  return (
    <Suspense
      fallback={
        <TextInput
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={field.placeholder || undefined}
          aria-describedby={describedBy}
          invalid={invalid}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v === '' ? undefined : v)}
          onAdvance={onAdvance}
          onFocus={() => (hadFocus.current = true)}
          onBlur={() => (hadFocus.current = false)}
          className="max-w-md"
        />
      }
    >
      <PhoneInput {...props} restoreFocus={hadFocus} />
    </Suspense>
  )
}
