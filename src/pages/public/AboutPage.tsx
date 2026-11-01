import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import type { PublicHome } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import { PublicSite } from '@/pages/public/home/PublicSite'
import { PageIntro, SectionHead } from '@/pages/public/home/sections'
import { DISPLAY, PRIMARY_BUTTON, SHELL } from '@/pages/public/home/site'
import { SiteFrame } from '@/pages/public/home/SiteFrame'

/** The copy below is a starting point; edit it here. The app name comes from Settings → General. */
const VALUES = [
  { title: 'Short by design', text: 'We only ask what we need, and each form says up front about how long it takes.' },
  { title: 'Read by a person', text: 'Your answers are read, not filed away, and you’ll hear back when they need a reply.' },
  { title: 'Your data, kept small', text: 'We ask only for what we need, and use it only to follow up on what you sent.' },
]

/** The public About page at /about. */
export default function AboutPage() {
  return <PublicSite>{(home) => <About home={home} />}</PublicSite>
}

function About({ home }: { home: PublicHome }) {
  return (
    <SiteFrame home={home} current="about">
      <title>{`About · ${home.appName}`}</title>
      <PageIntro eyebrow="About" title={`About ${home.appName}`}>
        <p className="text-answer text-muted-foreground">Who’s asking, and why.</p>
      </PageIntro>

      <section aria-label="Our story" className={SHELL}>
        <div className="grid max-w-[65ch] gap-5 border-t-2 border-border-ink pt-10 text-answer text-muted-foreground sm:text-subheading sm:font-normal">
          <p>
            {home.appName} would rather ask than guess. These forms are how clients, collaborators and anyone curious about the work get in touch.
          </p>
          <p>Whether you’re booking a slot, asking a question or saying how it went, a few minutes of your time helps get it right.</p>
          {home.contactEmail && (
            <p>
              Rather write? Email{' '}
              <a href={`mailto:${home.contactEmail}`} className="focus-ring rounded-sm break-all text-link underline underline-offset-4 hover:decoration-2">
                {home.contactEmail}
              </a>
              .
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="values-title" className={cn(SHELL, 'grid gap-10')}>
        <SectionHead id="values" eyebrow="How we work" title="What you can expect" />
        <ul className="border-t-2 border-border-ink">
          {VALUES.map((v) => (
            <li key={v.title} className="grid gap-3 border-b border-border py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-10">
              <h3 className={cn('text-heading-sm', DISPLAY)}>{v.title}</h3>
              <p className="max-w-[60ch] text-answer text-muted-foreground">{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Get started" className={SHELL}>
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-xl border border-border bg-card p-6 sm:p-10">
          <p className={cn('text-heading-sm', DISPLAY)}>{home.forms.length > 0 ? 'Ready when you are.' : 'New forms land on the home page.'}</p>
          <Link to="/forms" className={PRIMARY_BUTTON}>
            Browse forms
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      </section>
    </SiteFrame>
  )
}
