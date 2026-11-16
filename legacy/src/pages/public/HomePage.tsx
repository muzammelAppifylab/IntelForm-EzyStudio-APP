import { ArrowRight, ArrowUpRight, Check, Mail, MonitorSmartphone, ShieldCheck, UserRoundX } from 'lucide-react'
import { Link } from 'react-router'
import type { PublicHome } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import { PublicSite } from '@/pages/public/home/PublicSite'
import { FormsGrid, Hero, SectionHead } from '@/pages/public/home/sections'
import { DISPLAY, PRIMARY_BUTTON, SECONDARY_BUTTON, SHELL } from '@/pages/public/home/site'
import { SiteFrame } from '@/pages/public/home/SiteFrame'

/** Cards on the home page; the rest are on /forms. */
const HOME_FORMS = 6

const STEPS = [
  { title: 'Pick a form', text: 'Open the one that fits, whether it’s a booking, a question or feedback.' },
  { title: 'Answer a few questions', text: 'One question at a time, with the time it takes shown up front.' },
  { title: 'We read and reply', text: 'A person reads every answer and gets back to you when it needs a reply.' },
]

/** Decorative preview of a form, so the home page shows what you are about to open. */
function FormPreview() {
  return (
    <div aria-hidden className="animate-fade-up grid gap-6 rounded-xl border border-border bg-card p-6 text-card-foreground sm:p-8">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-pine" />
      </div>
      <div className="grid gap-1.5">
        <p className="text-overline text-muted-foreground">Question 2 of 6</p>
        <p className={cn('text-heading-sm sm:text-heading', DISPLAY)}>How was your visit?</p>
      </div>
      <div className="grid gap-3">
        {['Great, thank you', 'Good, with a few notes', 'Not quite right'].map((label, i) => (
          <div
            key={label}
            className={cn(
              'flex items-center justify-between rounded-md border px-4 py-3 text-body',
              i === 0 ? 'border-2 border-border-ink bg-option-selected text-option-selected-foreground' : 'border-input bg-background',
            )}
          >
            {label}
            {i === 0 && <Check className="size-4" />}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-caption text-muted-foreground">About 2 min</span>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-md border-2 border-primary-border bg-primary px-4 text-label text-primary-foreground">
          Continue
          <ArrowRight className="size-4" />
        </span>
      </div>
    </div>
  )
}

const TEXT_LINK = 'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-sm text-label text-link underline-offset-4 hover:underline'

/**
 * The public home page at /: who you are, your open forms and how to reach you. The copy below
 * is a starting point; edit it here. The app name and logo come from Settings → General, the
 * listed forms from each form's Share tab, and the contact email, search description and social
 * image from Settings → Public site.
 */
export default function HomePage() {
  return <PublicSite>{(home) => <Home home={home} />}</PublicSite>
}

function Home({ home }: { home: PublicHome }) {
  const ogImage = home.ogImage ? new URL(home.ogImage, location.origin).href : null
  const only = home.forms.length === 1 ? home.forms[0] : null
  const more = home.forms.length > HOME_FORMS
  return (
    <>
      <title>{home.appName}</title>
      {home.description && <meta name="description" content={home.description} />}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={home.appName} />
      {home.description && <meta property="og:description" content={home.description} />}
      <meta property="og:url" content={location.origin + '/'} />
      <meta property="og:site_name" content={home.appName} />
      {ogImage && <meta property="og:image" content={ogImage} />}
      <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />

      <SiteFrame home={home} current="home">
        <Hero
          title={home.appName}
          aside={<FormPreview />}
          actions={
            <>
              {/* One form: start it right here. Several: jump to the list. */}
              {only ? (
                <Link to={`/f/${only.slug}`} className={PRIMARY_BUTTON}>
                  {only.title}
                  <ArrowRight className="size-5" aria-hidden />
                </Link>
              ) : (
                home.forms.length > 0 && (
                  <a href="#forms-title" className={PRIMARY_BUTTON}>
                    See the forms
                    <ArrowRight className="size-5" aria-hidden />
                  </a>
                )
              )}
              <Link to="/about" className={SECONDARY_BUTTON}>
                About
              </Link>
            </>
          }
        >
          <p>Bookings, questions and feedback, all in one place. Pick a form and you’re done in a few minutes.</p>
        </Hero>

        <section aria-labelledby="forms-title" className={cn(SHELL, 'grid gap-8')}>
          <SectionHead
            id="forms"
            eyebrow="Open now"
            title="Forms"
            action={
              more && (
                <Link to="/forms" className={TEXT_LINK}>
                  See all {home.forms.length} forms
                  <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              )
            }
          />
          <FormsGrid
            forms={home.forms.slice(0, HOME_FORMS)}
            empty={home.contactEmail ? `Nothing is open right now. Questions? Email ${home.contactEmail}.` : 'Nothing is open right now. Check back soon.'}
          />
          <ul aria-label="Good to know" className="flex flex-wrap gap-x-8 gap-y-3 text-body-sm text-muted-foreground">
            <li className="inline-flex items-center gap-2">
              <UserRoundX className="size-4" aria-hidden />
              No account needed
            </li>
            <li className="inline-flex items-center gap-2">
              <MonitorSmartphone className="size-4" aria-hidden />
              Works on any device
            </li>
            {home.hasPrivacy && (
              <li className="inline-flex items-center gap-2">
                <ShieldCheck className="size-4" aria-hidden />
                <Link to="/privacy" className="focus-ring rounded-sm text-link underline underline-offset-4 hover:decoration-2">
                  How your answers are used
                </Link>
              </li>
            )}
          </ul>
        </section>

        <section aria-labelledby="steps-title" className={cn(SHELL, 'grid gap-10')}>
          <SectionHead id="steps" eyebrow="How it works" title="Three steps, a few minutes" />
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid content-start gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground sm:p-7">
                <span className={cn('text-heading-sm text-muted-foreground', DISPLAY)} aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className={cn('text-heading-sm', DISPLAY)}>{step.title}</h3>
                <p className="text-body text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="about-title" className={SHELL}>
          <div className={cn('grid gap-10 border-t-2 border-border-ink pt-12', home.contactEmail && 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-16')}>
            <div className="grid content-start justify-items-start gap-4">
              <p className="text-overline text-muted-foreground">About</p>
              <h2 id="about-title" className={cn('text-heading sm:text-title', DISPLAY)}>
                Who you’re talking to
              </h2>
              <p className="max-w-[65ch] text-answer text-muted-foreground">
                {home.appName} uses these forms to hear from clients and anyone curious about the work. Every answer is read by a person, and you’ll hear back
                if it needs a reply.
              </p>
              <Link to="/about" className={TEXT_LINK}>
                More about {home.appName}
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </div>
            {home.contactEmail && (
              <div className="grid content-start gap-3 self-start rounded-xl border border-border bg-card p-6 text-card-foreground sm:p-8">
                <span className="grid size-11 place-items-center rounded-full border-2 border-border-ink">
                  <Mail className="size-5" aria-hidden />
                </span>
                <h3 className={cn('text-heading-sm', DISPLAY)}>Rather write?</h3>
                <p className="text-body text-muted-foreground">Questions about a form, or something else entirely.</p>
                <a href={`mailto:${home.contactEmail}`} className="focus-ring justify-self-start rounded-sm text-subheading break-all text-link underline underline-offset-4 hover:decoration-2">
                  {home.contactEmail}
                </a>
              </div>
            )}
          </div>
        </section>
      </SiteFrame>
    </>
  )
}
