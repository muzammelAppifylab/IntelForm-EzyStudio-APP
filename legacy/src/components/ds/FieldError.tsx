import { CircleAlert } from 'lucide-react'

/** Error text under a control: `destructive`, with an alert icon so it never relies on colour. Fades up into place. */
export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="flex animate-fade-up items-center gap-1.5 text-caption text-destructive">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  )
}
