import { cn } from '@/components/ui/cn'
import { STATUS_LABEL, type Status } from './status'

const STATUS_CLASS: Record<Status, string> = {
  live: 'bg-success-subtle text-success-subtle-foreground',
  draft: 'bg-card text-foreground ring-1 ring-border ring-inset',
  closed: 'bg-muted text-muted-foreground',
  unpublished: 'bg-warning-subtle text-warning-subtle-foreground',
  new: 'bg-info-subtle text-info-subtle-foreground',
}

export interface StatusBadgeProps {
  status: Status
  /** Overrides the default word ("Live", "Draft"…). The word is always shown; the dot is decoration. */
  label?: string
  className?: string
}

/**
 * Pill naming a form's or response's state: 20px, `radius-md`, `caption` 500. Live = soft pine tint, Draft = paper with a hairline, Closed = muted.
 * The Live dot carries a slow ping ring (hidden under reduced motion).
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-md px-2 text-caption font-medium whitespace-nowrap',
        STATUS_CLASS[status],
        className,
      )}
    >
      <span className="relative grid size-1.5 shrink-0" aria-hidden>
        {status === 'live' && <span className="absolute inset-0 animate-live-ping rounded-full bg-current" />}
        <span className="rounded-full bg-current" />
      </span>
      {label ?? STATUS_LABEL[status]}
    </span>
  )
}
