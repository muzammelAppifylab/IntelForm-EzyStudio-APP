import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/components/ui/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  /** What will appear here: "No responses yet". */
  title: string
  /** The first step: "Share your form to start collecting them." */
  children?: ReactNode
  /** Usually one Button (the first action) and optionally a ghost secondary. */
  actions?: ReactNode
  /** Dashed outline on `card`. Turn off when the empty state already sits inside a card. */
  bordered?: boolean
  /** Heading level for the title. Default h2. */
  as?: 'h2' | 'h3'
  className?: string
}

/** Names what will appear and the first action. Calm: icon in an `accent` tile, no illustration. */
export function EmptyState({ icon: Icon, title, children, actions, bordered = true, as: Heading = 'h2', className }: EmptyStateProps) {
  return (
    <section
      data-slot="empty-state"
      className={cn(
        'grid animate-fade-up place-items-center px-6 py-12 text-center',
        bordered && 'rounded-lg border border-dashed border-input bg-card',
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-3">
        {Icon && (
          <span className="mb-1 grid size-12 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
        )}
        <Heading className="text-subheading text-balance text-foreground">{title}</Heading>
        {children && <div className="text-body text-pretty text-muted-foreground">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </section>
  )
}
