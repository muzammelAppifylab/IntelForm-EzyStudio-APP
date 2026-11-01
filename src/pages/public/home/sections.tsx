import { ArrowRight, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { minutesLabel, type PublicFormCard } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import { DISPLAY, SHELL } from './site'

const pad = (i: number) => String(i + 1).padStart(2, '0')

// ---------------------------------------------------------------------------
// Hero

/** The page's opening: a headline at hero size, a short text, the actions and an optional visual (from HomePage.tsx). */
export function Hero({ title, children, actions, aside }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby="hero-title" className={cn(SHELL, 'pt-14 sm:pt-24')}>
      <div className={cn('grid items-center gap-12', aside && 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16')}>
        <div className="grid max-w-3xl justify-items-start gap-6">
          <h1 id="hero-title" className={cn('text-title break-words sm:text-hero', DISPLAY)}>
            {title}
          </h1>
          {children && <div className="grid max-w-xl gap-4 text-answer text-muted-foreground sm:text-subheading sm:font-normal">{children}</div>}
          {actions && <div className="flex flex-wrap items-center gap-3 pt-2">{actions}</div>}
        </div>
        {aside}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Section frame and intros

export function SectionHead({ id, eyebrow, title, children, action }: { id: string; eyebrow: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="grid max-w-2xl gap-3">
        <p className="text-overline text-muted-foreground">{eyebrow}</p>
        <h2 id={`${id}-title`} className={cn('text-heading sm:text-title', DISPLAY)}>
          {title}
        </h2>
        {children}
      </div>
      {action}
    </div>
  )
}

/** Title block that opens an inner page (Forms, About, legal). */
export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <section aria-labelledby="page-title" className={cn(SHELL, 'pt-12 sm:pt-20')}>
      <div className="grid max-w-3xl gap-4">
        <p className="text-overline text-muted-foreground">{eyebrow}</p>
        <h1 id="page-title" className={cn('text-title break-words sm:text-hero', DISPLAY)}>
          {title}
        </h1>
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Forms

export function FormsGrid({ forms, empty = 'No forms are open right now. Check back soon.' }: { forms: PublicFormCard[]; empty?: ReactNode }) {
  if (forms.length === 0) {
    return <p className="animate-fade-up rounded-xl border border-dashed border-input bg-card px-6 py-12 text-center text-body text-muted-foreground">{empty}</p>
  }
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {forms.map((f, i) => (
        <li key={f.slug}>
          <FormCard form={f} index={i} />
        </li>
      ))}
    </ul>
  )
}

function FormCard({ form, index }: { form: PublicFormCard; index: number }) {
  const minutes = minutesLabel(form.minutes)
  return (
    <article className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground transition-[border-color] duration-(--duration-fast) ease-out hover:border-border-ink sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <span className={cn('text-heading-sm text-muted-foreground', DISPLAY)} aria-hidden>
          {pad(index)}
        </span>
        {minutes && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-caption text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            {minutes}
          </span>
        )}
      </div>
      <h3 className={cn('text-heading-sm break-words', DISPLAY)}>{form.title}</h3>
      {form.description && <p className="line-clamp-4 text-body text-muted-foreground">{form.description}</p>}
      <div className="mt-auto pt-2">
        <Link
          to={`/f/${form.slug}`}
          aria-label={`Open ${form.title}`}
          className="focus-ring press inline-flex h-11 items-center gap-1.5 rounded-(--form-radius) border-2 border-primary-border bg-secondary px-5 text-label text-secondary-foreground transition-[background-color,scale] duration-(--duration-fast) ease-out group-hover:bg-primary group-hover:text-primary-foreground hover:bg-primary-hover"
        >
          Open
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </article>
  )
}
