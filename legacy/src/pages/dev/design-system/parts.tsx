import type { ReactNode } from 'react'
import { cn } from '@/components/ui/cn'

/** One reference section: overline, title, intro and content on the canvas. */
export function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-24 gap-6">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-heading text-foreground">
          {title}
        </h2>
        {intro && <p className="max-w-prose text-body text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

/** A bordered card that labels what it shows. */
export function Specimen({
  title,
  note,
  children,
  className,
  bodyClassName,
}: {
  title: string
  note?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-4 rounded-lg border border-border bg-card p-6', className)}>
      <div className="grid gap-0.5">
        <h3 className="text-label text-foreground">{title}</h3>
        {note && <p className="text-caption text-muted-foreground">{note}</p>}
      </div>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-3', bodyClassName)}>{children}</div>
    </div>
  )
}

/** Small caption under a state example ("Hover", "Disabled"…). */
export function State({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-w-0 content-start gap-2', className)}>
      {children}
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  )
}

/**
 * Static stand-in for :focus-visible, so the ring shows in screenshots. It mirrors the `focus-ring`
 * utility exactly (2px `ring`, 2px offset).
 */
export const FAKE_FOCUS = 'outline-2 outline-offset-2 outline-ring outline-solid'
