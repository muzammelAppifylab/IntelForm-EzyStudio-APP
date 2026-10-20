import { cn } from '@/components/ui/cn'
import { STATUS_LABEL, type Status } from './status'

const STATUS_CLASS: Record<Status, string> = {
  live: 'bg-pine text-pine-foreground',
  draft: 'bg-background text-foreground ring-2 ring-border-ink ring-inset',
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
 * Pill naming a form's or response's state: 24px, `radius-full`, `caption` 500. Live = pine fill, Draft = paper with a 2px ink edge, Closed = muted.
 * The Live dot carries a slow ping ring (hidden under reduced motion).
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium whitespace-nowrap',
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
