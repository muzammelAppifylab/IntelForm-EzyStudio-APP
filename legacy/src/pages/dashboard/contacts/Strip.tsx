import { ArrowRight, Check } from 'lucide-react'
import { Link } from 'react-router'
import type { ContactsStrip } from '@shared/api-contacts'
import { FORM_STATUS_LABEL } from '@shared/api-forms'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatNumber } from './format'

/** The dark chamber with the contact totals, beside the forms that collected the most contacts. */
export function Strip({ strip, activeForms, onForm }: { strip: ContactsStrip | undefined; activeForms: string[]; onForm: (id: string) => void }) {
  if (!strip) {
    return (
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ContactsChamber strip={strip} />
      <MostContacts strip={strip} activeForms={activeForms} onForm={onForm} />
    </div>
  )
}

function ContactsChamber({ strip }: { strip: ContactsStrip }) {
  const stats = [
    { label: 'New this week', value: formatNumber(strip.newThisWeek) },
    { label: 'Returning', value: formatNumber(strip.returning) },
    { label: 'With a phone number', value: `${Math.round(strip.withPhonePct)}%` },
  ]
  return (
    <section
      aria-labelledby="contacts-total-title"
      className="grid gap-6 rounded-lg border border-border bg-card p-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] @3xl:gap-8"
    >
      <div className="grid content-start gap-2">
        <h2 id="contacts-total-title" className="text-label text-muted-foreground">
          Contacts, all forms
        </h2>
        <p className="text-metric tabular-nums">{formatNumber(strip.total)}</p>
        <p className="max-w-xs text-caption text-muted-foreground">People who left an email or phone number in a response</p>
      </div>
      <dl className="grid content-center divide-y divide-border border-t border-border @3xl:border-t-0 @3xl:border-l @3xl:pl-8">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-4 py-3 first:pt-3 @3xl:first:pt-0 last:pb-0">
            <dt className="text-label text-muted-foreground">{s.label}</dt>
            <dd className="text-heading-sm tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function MostContacts({ strip, activeForms, onForm }: { strip: ContactsStrip; activeForms: string[]; onForm: (id: string) => void }) {
  return (
    <section aria-labelledby="most-contacts-title" className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
      <div className="grid gap-1">
        <h2 id="most-contacts-title" className="text-heading-sm">
          Most contacts
        </h2>
        <p className="text-caption text-muted-foreground">Pick a form to see only its contacts</p>
      </div>
      {strip.topForms.length === 0 ? (
        <p className="border-t border-border pt-5 text-body-sm text-muted-foreground">No form has collected a contact yet.</p>
      ) : (
        <ol className="grid divide-y divide-border border-t border-border">
          {strip.topForms.map((f, i) => {
            const active = activeForms.length === 1 && activeForms[0] === f.id
            return (
              <li key={f.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onForm(f.id)}
                  className={cn(
                    'focus-ring group -mx-2 grid w-[calc(100%+1rem)] cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-3 text-left transition-colors duration-(--duration-fast) ease-out hover:bg-accent/60',
                    active && 'bg-accent',
                  )}
                >
                  <span className="text-heading-sm text-muted-foreground" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate text-label group-hover:underline">{f.title}</span>
                    <span className="truncate text-caption text-muted-foreground">
                      {FORM_STATUS_LABEL[f.status]}
                      {active && (
                        <>
                          {' · '}
                          <Check className="inline size-3 align-[-1px]" aria-hidden /> Filtered
                        </>
                      )}
                    </span>
                  </span>
                  <span className="text-label tabular-nums">
                    {formatNumber(f.contacts)}
                    <span className="sr-only"> {f.contacts === 1 ? 'contact' : 'contacts'}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <Link to="/dashboard" className="focus-ring inline-flex w-fit items-center gap-1.5 rounded-sm text-label text-link hover:underline">
        View all forms
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}
