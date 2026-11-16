import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router'
import { FORM_STATUS_LABEL, type FormsStrip } from '@shared/api-forms'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/components/ui/cn'
import { formatCount, formatRate } from './format'
import { responsesPath } from './queries'

/** KPI strip, then this week's responses per day beside the most active forms. */
export function Overview({ strip }: { strip: FormsStrip | undefined }) {
  if (!strip) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-24 rounded-lg" />
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <KpiStrip strip={strip} />
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ResponsesChart strip={strip} />
        <MostActive strip={strip} />
      </div>
    </div>
  )
}

function KpiStrip({ strip }: { strip: FormsStrip }) {
  const { responsesThisWeek: now, responsesLastWeek: before } = strip
  const diff = now - before
  const pct = before > 0 ? Math.round((Math.abs(diff) / before) * 100) : null
  const trend =
    diff === 0
      ? `Same as last week (${formatCount(before)})`
      : pct === null
        ? 'Up from none last week'
        : `${pct}% ${diff > 0 ? 'more' : 'fewer'} than last week`
  return (
    <dl className="grid divide-y divide-border rounded-lg border border-border bg-card @xl:grid-cols-3 @xl:divide-x @xl:divide-y-0">
      <div className="grid gap-1 p-5">
        <dt className="text-label text-muted-foreground">Responses, last 7 days</dt>
        <dd className="text-metric tabular-nums">{formatCount(now)}</dd>
        <p className="flex items-center gap-1 text-caption text-muted-foreground">
          {diff > 0 && <ArrowUpRight className="size-3.5 shrink-0 text-pine" aria-hidden />}
          {diff < 0 && <ArrowDownRight className="size-3.5 shrink-0 text-destructive" aria-hidden />}
          {trend}
        </p>
      </div>
      <div className="grid gap-1 p-5">
        <dt className="text-label text-muted-foreground">Live forms</dt>
        <dd className="text-metric tabular-nums">{formatCount(strip.counts.live)}</dd>
        <p className="text-caption text-muted-foreground">of {formatCount(strip.counts.all)} total</p>
      </div>
      <div className="grid gap-1 p-5">
        <dt className="text-label text-muted-foreground">Avg. completion</dt>
        <dd className="text-metric tabular-nums">{formatRate(strip.avgCompletion)}</dd>
        <p className="text-caption text-muted-foreground">Across live and closed forms</p>
      </div>
    </dl>
  )
}

function ResponsesChart({ strip }: { strip: FormsStrip }) {
  return (
    <section aria-labelledby="week-title" className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
      <div className="grid gap-0.5">
        <h2 id="week-title" className="text-heading-sm">Responses per day</h2>
        <p className="text-caption text-muted-foreground">Last 7 days</p>
      </div>
      <DayBars days={strip.days} />
    </section>
  )
}

/** Rounds the chart's top line up to 1, 2 or 5 × 10ⁿ so the gridline labels stay readable. */
function niceMax(n: number): number {
  if (n <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p
}

const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })

function DayBars({ days }: { days: FormsStrip['days'] }) {
  const top = niceMax(Math.max(...days.map((d) => d.count), 0))
  const today = days.at(-1)
  return (
    <figure className="grid min-w-0 content-end gap-3">
      <figcaption className="sr-only">
        Responses per day: {days.map((d, i) => `${i === days.length - 1 ? 'today' : weekday(d.date)} ${d.count}`).join(', ')}
      </figcaption>
      <div aria-hidden className="relative mt-8 grid h-48 grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
        {/* Gridlines at the top and middle */}
        <div className="relative text-caption text-muted-foreground">
          <span className="absolute top-0 -translate-y-1/2">{top}</span>
          <span className="absolute top-1/2 -translate-y-1/2">{top / 2}</span>
        </div>
        <div className="relative">
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
          <div className="absolute inset-x-0 bottom-0 border-t border-border" />
          <ol className="relative grid h-full grid-cols-7 items-end gap-2 sm:gap-3">
            {days.map((d, i) => {
              const isToday = i === days.length - 1
              return (
                <li key={d.date} className="relative flex h-full items-end justify-center">
                  {isToday && (
                    // Pinned above the chart's top line, so it never covers a neighbouring bar.
                    <span className="absolute -top-8 right-0 z-10 rounded-md bg-foreground px-2 py-1 text-caption font-medium whitespace-nowrap text-background">
                      Today so far · {formatCount(d.count)}
                    </span>
                  )}
                  <span
                    className={cn('w-full max-w-10 origin-bottom animate-bar-grow rounded-t-md rounded-b-[2px] transition-[height] duration-(--duration-slow) ease-out', isToday ? 'bg-highlight' : 'bg-chart-1/70')}
                    style={{ height: `${Math.max(d.count ? 3 : 1.5, (d.count / top) * 100)}%`, animationDelay: `${i * 45}ms` }}
                  />
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      <ol aria-hidden className="ml-10 grid grid-cols-7 gap-2 text-center text-caption text-muted-foreground sm:gap-3">
        {days.map((d, i) => (
          <li key={d.date} className={cn(i === days.length - 1 && 'font-semibold text-foreground')}>
            {i === days.length - 1 ? 'Today' : weekday(d.date)}
          </li>
        ))}
      </ol>
      {!today && <p className="text-caption text-muted-foreground">No data yet.</p>}
    </figure>
  )
}

function MostActive({ strip }: { strip: FormsStrip }) {
  return (
    <section aria-labelledby="active-title" className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
      <div className="grid gap-1">
        <h2 id="active-title" className="text-heading-sm">
          Most new responses
        </h2>
        <p className="text-caption text-muted-foreground">This week</p>
      </div>
      {strip.mostActive.length === 0 ? (
        <p className="border-t border-border pt-5 text-body-sm text-muted-foreground">No new responses in the last 7 days.</p>
      ) : (
        <ol className="grid divide-y divide-border border-t border-border">
          {strip.mostActive.map((f, i) => (
            <li key={f.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3">
              <span className="text-label text-muted-foreground tabular-nums" aria-hidden>
                {i + 1}
              </span>
              <div className="grid min-w-0 gap-0.5">
                <Link to={responsesPath(f.id)} className="focus-ring truncate rounded-sm text-label hover:underline">
                  {f.title}
                </Link>
                <span className="truncate text-caption text-muted-foreground">
                  {FORM_STATUS_LABEL[f.status]}
                  {f.completionRate !== null && ` · ${formatRate(f.completionRate)} completion`}
                </span>
              </div>
              <span className="text-label text-pine tabular-nums">
                +{formatCount(f.count)}
                <span className="sr-only"> new {f.count === 1 ? 'response' : 'responses'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
