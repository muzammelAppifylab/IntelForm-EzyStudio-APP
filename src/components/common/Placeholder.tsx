import type { LucideIcon } from 'lucide-react'

/**
 * Stand-in for a screen a later milestone builds (see IntelForm-Research/04-Next-Steps).
 * Delete each one as its screen lands.
 */
export function Placeholder({ icon: Icon, title, milestone, children }: { icon: LucideIcon; title: string; milestone: number; children: string }) {
  return (
    <section className="grid place-items-center rounded-lg border border-dashed border-input bg-card px-6 py-16 text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-6" aria-hidden />
        </span>
        <p className="text-overline text-muted-foreground">Milestone {milestone}</p>
        <h2 className="text-subheading">{title}</h2>
        <p className="text-body text-muted-foreground">{children}</p>
      </div>
    </section>
  )
}
