import type { ReactNode } from 'react'

/** Dashboard page title row: heading in Instrument Serif 400 (`text-heading`), optional intro and actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <title>{title}</title>
      <div className="grid gap-1">
        <h1 className="text-heading text-foreground">{title}</h1>
        {description && <p className="max-w-prose text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
