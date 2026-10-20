import { CircleAlert } from 'lucide-react'
import { smallButtonClass } from '../classes'
import type { FormErrorAction } from './context'

/** A submit-level error (network, closed, rate limit) near the submit button, with an optional action (Reload). */
export function SubmitError({ message, action }: { message: string | null; action?: FormErrorAction | null }) {
  if (!message) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-danger-subtle px-3 py-2.5 text-body text-danger-subtle-foreground">
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </p>
      {action && (
        <button type="button" data-slot="button" data-variant="outline" data-size="sm" onClick={action.run} className={smallButtonClass}>
          {action.label}
        </button>
      )}
    </div>
  )
}
