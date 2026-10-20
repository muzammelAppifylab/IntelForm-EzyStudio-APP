import { ArrowRight, Clock, Mail, MapPin, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { minutesLabel, type PublicFormCard, type PublicHomeOn } from '@shared/api-front'
import { Logo } from '@/components/common/Logo'
import { cn } from '@/components/ui/cn'
import { PlainText } from './PlainText'
import { homePreset, homeThemeStyle } from './theme'

/** Display face of the chosen preset (the type tokens resolve on :root, so set it explicitly). */
const DISPLAY = 'font-(family-name:--form-question-font)'
const YEAR = new Date().getFullYear()
const SHELL = 'mx-auto w-full max-w-(--content-width) px-4 sm:px-6 lg:px-8'

/**
 * The creator's forms hub, used by the public page and the editor's live preview. Styled by
 * one theme preset (`themeToVars`) on top of the design system tokens.
 */
export function HomeView({ home, className }: { home: PublicHomeOn; className?: string }) {
  const preset = homePreset(home.themeId)
  const headline = home.hero.headline || home.appName
  return (
    <div
      className={cn('form-theme flex min-h-full flex-col bg-background text-body text-foreground', preset.mode === 'dark' && 'dark', className)}
      style={homeThemeStyle(preset)}
    >
      <header className={cn(SHELL, 'flex min-h-16 items-center gap-3 py-3')}>
        <Logo logoUrl={home.logoUrl} appName={home.appName} className="size-9" />
        <span className="text-subheading font-semibold">{home.appName}</span>
      </header>

      <main id="main" className="flex flex-1 flex-col gap-24 pb-24">
        <Hero home={home} headline={headline} />
        <FormsSection forms={home.forms} />
        {home.about && (
          <Section id="about" title={home.about.title || 'About'}>
            <PlainText text={home.about.text} className="text-body text-muted-foreground" />
          </Section>
        )}
        {home.contact && <ContactSection contact={home.contact} />}
      </main>

      <footer className="border-t border-border">
        <div className={cn(SHELL, 'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6 text-body-sm text-muted-foreground')}>
          <p>
            © {YEAR} {home.appName}
          </p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {home.hasPrivacy && <FooterLink to="/privacy">Privacy</FooterLink>}
            {home.hasTerms && <FooterLink to="/terms">Terms</FooterLink>}
            <FooterLink to="/login" className="text-caption">
              Team login
            </FooterLink>
          </nav>
        </div>
      </footer>
    </div>
  )
}

function FooterLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cn('focus-ring inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:text-foreground hover:underline', className)}>
      {children}
    </Link>
  )
}

function Hero({ home, headline }: { home: PublicHomeOn; headline: string }) {
  const { hero } = home
  return (
    <section aria-labelledby="hero-title" className={SHELL}>
      <div
        className={cn(
          'grid items-center gap-8 overflow-hidden rounded-xl border border-border px-6 py-10 sm:px-10 sm:py-14 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-14 lg:py-20',
          // No gradients (design system v2.1): the hero is a flat `accent` band.
          'bg-accent',
          !hero.imageUrl && 'md:grid-cols-1',
        )}
      >
        <div className={cn('grid justify-items-start gap-5', !hero.imageUrl && 'max-w-3xl')}>
          <h1 id="hero-title" className={cn('text-title break-words sm:text-hero', DISPLAY)}>
            {headline}
          </h1>
          {hero.text && <PlainText text={hero.text} className="text-answer" />}
          {hero.buttonLabel && hero.buttonUrl && (
            <a
              href={hero.buttonUrl}
              rel="noopener noreferrer"
              className="focus-ring inline-flex h-(--control-lg) items-center gap-2 rounded-(--form-radius) border-2 border-primary-border bg-primary px-6 text-answer font-medium text-primary-foreground transition-colors duration-(--duration-fast) hover:bg-primary-hover"
            >
              {hero.buttonLabel}
              <ArrowRight className="size-5" aria-hidden />
            </a>
          )}
        </div>
        {hero.imageUrl && (
          <img
            src={hero.imageUrl}
            alt={hero.imageAlt}
            width={480}
            height={360}
            fetchPriority="high"
            decoding="async"
            className="mx-auto max-h-80 w-full max-w-md rounded-lg object-contain"
          />
        )}
      </div>
    </section>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className={cn(SHELL, 'grid gap-6')}>
      <h2 id={`${id}-title`} className={cn('text-heading', DISPLAY)}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function FormsSection({ forms }: { forms: PublicFormCard[] }) {
  return (
    <Section id="forms" title="Forms">
      {forms.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-card px-6 py-10 text-center text-body text-muted-foreground">
          No forms are open right now. Check back soon.
        </p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((f) => (
            <li key={f.slug}>
              <FormCard form={f} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function FormCard({ form }: { form: PublicFormCard }) {
  const minutes = minutesLabel(form.minutes)
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground">
      <h3 className={cn('text-subheading break-words', DISPLAY)}>{form.title}</h3>
      {form.description && <p className="line-clamp-4 text-body text-muted-foreground">{form.description}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3">
        {minutes ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <Clock className="size-4" aria-hidden />
            {minutes}
          </span>
        ) : (
          <span />
        )}
        <Link
          to={`/f/${form.slug}`}
          aria-label={`Open ${form.title}`}
          className="focus-ring inline-flex h-11 items-center gap-1.5 rounded-(--form-radius) bg-primary px-5 text-label text-primary-foreground transition-colors duration-(--duration-fast) hover:bg-primary-hover"
        >
          Open
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </article>
  )
}

function ContactSection({ contact }: { contact: NonNullable<PublicHomeOn['contact']> }) {
  const item = 'flex items-start gap-3 text-body'
  const icon = 'mt-0.5 size-5 shrink-0 text-muted-foreground'
  return (
    <Section id="contact" title="Contact">
      <ul className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:max-w-xl">
        {contact.email && (
          <li className={item}>
            <Mail className={icon} aria-hidden />
            <a href={`mailto:${contact.email}`} className="focus-ring break-all rounded-sm underline underline-offset-4">
              <span className="sr-only">Email: </span>
              {contact.email}
            </a>
          </li>
        )}
        {contact.phone && (
          <li className={item}>
            <Phone className={icon} aria-hidden />
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="focus-ring rounded-sm underline underline-offset-4">
              <span className="sr-only">Phone: </span>
              {contact.phone}
            </a>
          </li>
        )}
        {contact.address && (
          <li className={item}>
            <MapPin className={icon} aria-hidden />
            <address className="not-italic">
              <span className="sr-only">Address: </span>
              <PlainText text={contact.address} />
            </address>
          </li>
        )}
      </ul>
    </Section>
  )
}
