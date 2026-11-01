import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ContactDetailResponse } from '@shared/api-contacts'
import { StatusBadge } from '@/components/ds/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { responsesPath } from '../forms/queries'
import { ContactAvatar, CopyButton, Country } from './bits'
import { contactTitle, deviceLabel, formatDate, formatDuration, formatNumber, formatPhone, fullDate, plural, relative } from './format'
import { contactDetailQuery } from './queries'

/** The Responses tab opens a response's drawer from `?response=<id>`. */
const responseLink = (formId: string, responseId: string) => `${responsesPath(formId)}?view=table&response=${encodeURIComponent(responseId)}`

/** One contact: details, the forms they answered and every response, newest first. Opened by `?contact=<key>`. */
export function ContactSheet({
  contactKey,
  onClose,
  onDelete,
  csvFor,
}: {
  contactKey: string | null
  onClose: () => void
  onDelete: ((detail: ContactDetailResponse) => void) | null
  csvFor: (keys: string[]) => string
}) {
  const open = !!contactKey
  const { data, error, refetch } = useQuery({ ...contactDetailQuery(contactKey ?? ''), enabled: open })
  const detail = data && data.contact.key === contactKey ? data : undefined
  const c = detail?.contact

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg" aria-describedby={undefined}>
        <SheetHeader className="gap-4 border-b border-border p-6 pr-14">
          {c ? (
            <div className="flex items-center gap-4">
              <ContactAvatar contact={c} size="lg" />
              <div className="grid min-w-0 gap-1">
                <SheetTitle className="truncate text-heading-sm">{contactTitle(c)}</SheetTitle>
                <SheetDescription>
                  Contact since <time dateTime={c.firstSeen} title={fullDate(c.firstSeen)}>{formatDate(c.firstSeen)}</time>
                </SheetDescription>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="grid flex-1 gap-2">
                <SheetTitle className="sr-only">Contact</SheetTitle>
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {error && !detail ? (
            <Alert variant="destructive">
              <AlertTitle>This contact didn’t load</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {errorMessage(error)}
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : !detail || !c ? (
            <div className="grid gap-5" aria-busy="true" aria-label="Loading contact">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="grid gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-5 w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            // grid-cols-1 (minmax(0, 1fr)) keeps long form titles truncating instead of widening the sheet.
            <div className="grid grid-cols-1 gap-8">
              <dl className="grid grid-cols-1 gap-4">
                <DetailRow label="Email" copy={c.email ? { value: c.email, label: 'Copy email', done: 'Email copied' } : undefined}>
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="focus-ring rounded-sm break-all text-link hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No email</span>
                  )}
                </DetailRow>
                <DetailRow label="Phone" copy={c.phone ? { value: c.phone, label: 'Copy phone number', done: 'Phone number copied' } : undefined}>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="focus-ring rounded-sm text-link tabular-nums hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No phone number</span>
                  )}
                </DetailRow>
                <DetailRow label="Country">
                  <Country code={c.country} />
                </DetailRow>
                <DetailRow label="First seen">
                  <time dateTime={c.firstSeen}>{fullDate(c.firstSeen)}</time>
                </DetailRow>
                <DetailRow label="Last active">
                  <time dateTime={c.lastSeen} title={fullDate(c.lastSeen)}>
                    {relative(c.lastSeen)}
                  </time>
                </DetailRow>
              </dl>

              <dl className="grid grid-cols-2 gap-3">
                <Stat label={c.responseCount === 1 ? 'Response' : 'Responses'} value={formatNumber(c.responseCount)} />
                <Stat label={c.formCount === 1 ? 'Form' : 'Forms'} value={formatNumber(c.formCount)} />
              </dl>

              <section aria-labelledby="contact-forms" className="grid grid-cols-1 gap-3">
                <h3 id="contact-forms" className="text-overline text-muted-foreground">
                  Forms answered
                </h3>
                <ul className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card">
                  {detail.forms.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                      <Link to={responsesPath(f.id)} className="focus-ring min-w-0 flex-1 truncate rounded-sm text-label hover:underline">
                        {f.title}
                      </Link>
                      <StatusBadge status={f.status} />
                      <span className="w-24 shrink-0 text-right text-body-sm tabular-nums text-muted-foreground">{plural(f.responses, 'response')}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="contact-timeline" className="grid grid-cols-1 gap-3">
                <h3 id="contact-timeline" className="text-overline text-muted-foreground">
                  Responses
                </h3>
                <ol className="grid grid-cols-1">
                  {detail.responses.map((r, i) => {
                    const meta = [deviceLabel(r.device), r.durationMs !== null ? `took ${formatDuration(r.durationMs)}` : null].filter(Boolean).join(' · ')
                    return (
                      <li key={r.id} className="relative grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0">
                        {/* The timeline rail */}
                        {i < detail.responses.length - 1 && <span aria-hidden className="absolute top-4 bottom-0 left-2 w-px -translate-x-1/2 bg-border" />}
                        <span aria-hidden className="mt-1.5 size-2.5 justify-self-center rounded-full border border-border bg-card" />
                        <div className="grid min-w-0 grid-cols-1 gap-0.5">
                          <Link
                            to={responseLink(r.form.id, r.id)}
                            className="focus-ring group inline-flex w-fit max-w-full items-center gap-1 rounded-sm text-label hover:underline"
                          >
                            <span className="truncate">{r.form.title}</span>
                            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                            <span className="sr-only">, open this response</span>
                          </Link>
                          <p className="text-caption text-muted-foreground">
                            <time dateTime={r.submittedAt}>{fullDate(r.submittedAt)}</time>
                            {meta && ` · ${meta}`}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
                {detail.responses.length < c.responseCount && (
                  <p className="text-caption text-muted-foreground">Showing the latest {formatNumber(detail.responses.length)}. Each form’s Responses tab has the rest.</p>
                )}
              </section>
            </div>
          )}
        </div>

        {detail && c && (
          <SheetFooter className="flex-row flex-wrap items-center gap-2 border-t border-border">
            <Button asChild variant="outline" size="sm">
              <a href={csvFor([c.key])} download>
                <Download aria-hidden />
                Export CSV
              </a>
            </Button>
            {onDelete && (
              <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => onDelete(detail)}>
                <Trash2 aria-hidden />
                Delete contact
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DetailRow({ label, copy, children }: { label: string; copy?: { value: string; label: string; done: string }; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-body-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
      <span className="size-(--control-sm)">{copy && <CopyButton {...copy} />}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border border-border bg-card p-4">
      <dt className="order-last text-caption text-muted-foreground">{label}</dt>
      <dd className="text-heading-sm tabular-nums">{value}</dd>
    </div>
  )
}
