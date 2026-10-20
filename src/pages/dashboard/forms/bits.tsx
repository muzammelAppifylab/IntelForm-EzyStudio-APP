import { Rows3 } from 'lucide-react'
import type { ReactNode } from 'react'
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

/** Small labelled metric used in the strip. */
export function StatTile({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid content-start gap-2 rounded-lg border bg-card p-5', className)} aria-label={label}>
      <h2 className="text-overline text-muted-foreground uppercase">{label}</h2>
      {children}
    </section>
  )
}
