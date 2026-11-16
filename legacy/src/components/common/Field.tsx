import { useId, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Label } from '@/components/ui/label'

interface ControlProps {
  id: string
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
}

/**
 * Label, help text and error wired to one control (design system TextField rules): the error
 * sits below with an icon, and the control gets aria-invalid and aria-describedby.
 */
export function Field({
  label,
  description,
  error,
  required,
  children,
}: {
  label: string
  description?: string
  error?: string
  required?: boolean
  children: (props: ControlProps) => ReactNode
}) {
  const id = useId()
  const descId = description ? `${id}-desc` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-label">
        {label}
        {required && <span className="text-destructive" aria-hidden>*</span>}
      </Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': [descId, errId].filter(Boolean).join(' ') || undefined })}
      {description && <p id={descId} className="text-caption text-muted-foreground">{description}</p>}
      {error && (
        <p id={errId} className="flex items-center gap-1.5 text-caption text-destructive" role="alert">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

/** Form-level error banner (danger-subtle pair). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-subtle px-3 py-2.5 text-body-sm text-danger-subtle-foreground">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  )
}
