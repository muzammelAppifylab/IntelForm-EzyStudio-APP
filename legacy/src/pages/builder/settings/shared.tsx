import type { ReactNode } from 'react'

export function SettingsCard({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 rounded-lg border border-border bg-card">
      <header className="grid gap-1 border-b border-border px-6 py-4">
        <h2 id={`${id}-h`} className="text-subheading text-foreground">
          {title}
        </h2>
        {description && <p className="text-body-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="grid gap-5 px-6 py-5">{children}</div>
    </section>
  )
}
