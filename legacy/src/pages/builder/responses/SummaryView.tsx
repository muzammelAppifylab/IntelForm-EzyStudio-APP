import { useQuery } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { SummaryRange, SummaryResponse } from '@shared/api-responses'
import { StatCard } from '@/components/ds'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { SUMMARY_CARDS } from '@/form-types/summaries'
import type { SummaryCardProps } from './cards'
import { formatDay, formatDuration, formatNumber, formatPct, plural } from './format'
import { RangePicker } from './RangePicker'
import { summaryQuery, type SummaryState } from './queries'

const chartConfig = { count: { label: 'Responses', color: 'var(--chart-1)' } } satisfies ChartConfig

export interface SummaryViewProps {
  formId: string
  state: SummaryState
  onRange: (range: SummaryRange, from?: string, to?: string) => void
  onFilter: (fieldId: string, value: string, range: SummaryResponse['range']) => void
  onViewAll: (fieldId: string, range: SummaryResponse['range']) => void
  onOpenResponse: (id: string) => void
  /** Rendered instead of the view when the form has no responses at all. */
  empty: React.ReactNode
}

export function SummaryView({ formId, state, onRange, onFilter, onViewAll, onOpenResponse, empty }: SummaryViewProps) {
  const { data, error, isPending, isPlaceholderData, refetch } = useQuery(summaryQuery(formId, state))

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The summary didn’t load</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          {errorMessage(error)}
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (isPending || !data) return <SummarySkeleton />
  if (data.formTotal === 0) return <>{empty}</>

  const t = data.totals
  const range = data.range
  return (
    <div className="grid gap-6" aria-busy={isPlaceholderData}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">
          {formatDay(range.from)} – {formatDay(range.to)}
        </p>
        <RangePicker range={state.range} from={state.from} to={state.to} onChange={onRange} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Views" value={formatNumber(t.views)} description="Form page loads" />
        <StatCard label="Starts" value={formatNumber(t.starts)} description="Began answering" />
        <StatCard label="Responses" value={formatNumber(t.responses)} description="Submitted" />
        <StatCard
          label="Completion rate"
          value={formatPct(t.completionRate === null ? null : t.completionRate * 100)}
          description="Responses ÷ starts"
        />
        <StatCard
          label="Avg. completion time"
          value={formatDuration(t.avgMs)}
          description={t.medianMs !== null ? `Median ${formatDuration(t.medianMs)}` : 'No timings yet'}
          className="col-span-2 md:col-span-1"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="over-time" className="grid gap-4 rounded-lg border border-border bg-card p-6 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="over-time" className="text-label text-foreground">
              Responses over time
            </h3>
            <span className="text-caption text-muted-foreground tabular-nums">{plural(t.responses, 'response')}</span>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full" aria-label={`Responses per day, ${formatDay(range.from)} to ${formatDay(range.to)}`} role="img">
            <LineChart data={data.series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={formatDay} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(v) => formatDay(String(v))} />} />
              <Line dataKey="count" type="monotone" stroke="var(--color-count)" strokeWidth={2} dot={data.series.length <= 31 ? { r: 2 } : false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </section>
        <Funnel views={t.views} starts={t.starts} responses={t.responses} />
      </div>

      {data.questions.length === 0 ? (
        <p className="text-body text-muted-foreground">This form has no questions to summarise.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.questions.map((q) => {
            const Card = SUMMARY_CARDS[q.type]
            if (!Card) return null
            const props: SummaryCardProps = {
              question: q,
              totalResponses: t.responses,
              onFilter: (f, v) => onFilter(f, v, range),
              onViewAll: (f) => onViewAll(f, range),
              onOpenResponse,
            }
            return <Card key={q.fieldId} {...props} />
          })}
        </div>
      )}
    </div>
  )
}

/** A 3-step funnel, not a "drop-off" chart: there is no per-question reach data. */
function Funnel({ views, starts, responses }: { views: number; starts: number; responses: number }) {
  const steps = [
    { label: 'Views', n: views },
    { label: 'Starts', n: starts },
    { label: 'Responses', n: responses },
  ]
  const max = Math.max(1, views, starts, responses)
  return (
    <section aria-labelledby="funnel" className="grid content-start gap-4 rounded-lg border border-border bg-card p-6">
      <h3 id="funnel" className="text-label text-foreground">
        Views → Starts → Responses
      </h3>
      <ol className="grid gap-4">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].n : null
          return (
            <li key={s.label} className="grid gap-1.5">
              <div className="flex items-baseline gap-2 text-body-sm">
                <span className="flex-1 text-foreground">{s.label}</span>
                <span className="font-medium text-foreground tabular-nums">{formatNumber(s.n)}</span>
                {prev !== null && (
                  <span className="w-14 text-right text-caption text-muted-foreground tabular-nums">
                    {prev > 0 ? formatPct(Math.min(100, (s.n / prev) * 100)) : '–'}
                  </span>
                )}
              </div>
              <span className="block h-2 overflow-hidden rounded-full bg-progress-track" aria-hidden>
                <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(s.n / max) * 100}%` }} />
              </span>
            </li>
          )
        })}
      </ol>
      <p className="text-caption text-muted-foreground">Percentages compare each step with the one before it.</p>
    </section>
  )
}

export function SummarySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading summary">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
