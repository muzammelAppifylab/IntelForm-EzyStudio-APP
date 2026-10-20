import { TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import type { FormsStrip } from '@shared/api-forms'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from './bits'
import { formatCount } from './format'
import { responsesPath } from './queries'

/** Responses this week across all forms, and the forms with the most new responses. */
export function TopStrip({ strip }: { strip: FormsStrip | undefined }) {
  if (!strip) {
    return (
      <div className="grid gap-4 @3xl:grid-cols-3">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg @3xl:col-span-2" />
      </div>
    )
  }

  const { responsesThisWeek: now, responsesLastWeek: before, mostActive } = strip
  const diff = now - before
  const top = mostActive[0]?.count ?? 0

  return (
    <div className="grid gap-4 @3xl:grid-cols-3">
      <StatTile label="Responses this week">
        <p className="text-metric tabular-nums">{formatCount(now)}</p>
        <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
          {diff > 0 && <TrendingUp className="mt-px size-3.5 shrink-0 text-pine" aria-hidden />}
          {diff < 0 && <TrendingDown className="mt-px size-3.5 shrink-0" aria-hidden />}
          {diff === 0 ? 'Same as the week before' : `${formatCount(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} than the week before`}
        </p>
      </StatTile>

      <StatTile label="Most active this week" className="@3xl:col-span-2">
        {mostActive.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No new responses in the last 7 days.</p>
        ) : (
          <ol className="grid gap-2.5">
            {mostActive.map((f) => (
              <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                <Link to={responsesPath(f.id)} className="focus-ring truncate rounded-sm text-label hover:underline">{f.title}</Link>
                <span className="text-body-sm tabular-nums text-muted-foreground">
                  {formatCount(f.count)} {f.count === 1 ? 'response' : 'responses'}
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-chart-1" style={{ width: `${top ? Math.max(4, (f.count / top) * 100) : 0}%` }} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </StatTile>
    </div>
  )
}
