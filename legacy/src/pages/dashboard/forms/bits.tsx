import { Rows3 } from 'lucide-react'
import type { FormStatus } from '@shared/api-forms'
import { LAYOUT_LABEL, type Layout } from '@shared/form/definition'
import { StatusBadge } from '@/components/ds/StatusBadge'
import { cn } from '@/lib/utils'
import { LAYOUT_ICON } from './format'


/** Layout mode as an icon tile with an accessible name. */
export function LayoutIcon({ layout, className }: { layout: Layout; className?: string }) {
  const Icon = LAYOUT_ICON[layout] ?? Rows3
  const label = LAYOUT_LABEL[layout] ?? 'All at once'
  return (
    <span
      className={cn('grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground', className)}
      title={`Layout: ${label}`}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">Layout: {label}</span>
    </span>
  )
}

/** Draft / Live / Closed pill from the design system. */
export function FormStatusBadge({ status }: { status: FormStatus }) {
  return <StatusBadge status={status} />
}

export function UnpublishedBadge() {
  return <StatusBadge status="unpublished" />
}
