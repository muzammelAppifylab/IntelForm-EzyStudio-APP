import { useState, type ReactNode } from 'react'
import { ArrowRight, Timer } from 'lucide-react'
import type { ChoiceSummaryOption, QuestionData, QuestionSummary } from '@shared/api-responses'
import { NpsSummaryBar } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FIELD_ICONS } from '@/form-types/icons'
import { formatDuration, formatNumber, formatPct, plural } from './format'

/**
 * Summary cards, one per question (PRD "Responses and analytics"). The per-type entry points
 * are src/form-types/<type>/SummaryCard.tsx, collected in src/form-types/summaries.tsx.
 */

export interface SummaryCardProps {
  question: QuestionSummary
  /** Responses in the selected range: the denominator for counts like "signed". */
  totalResponses: number
  /** Open the table filtered to this value (option id, "true"/"false", country code, score). */
  onFilter: (fieldId: string, value: string) => void
  /** Open the table showing only responses that answered this question. */
  onViewAll: (fieldId: string) => void
  onOpenResponse: (responseId: string) => void
}

type Of<K extends QuestionData['kind']> = Extract<QuestionData, { kind: K }>

export function QuestionCard({ question, children, action }: { question: QuestionSummary; children: ReactNode; action?: ReactNode }) {
  const Icon = FIELD_ICONS[question.type]
  return (
    <section
      aria-labelledby={`q-${question.fieldId}`}
      data-testid={`summary-${question.fieldId}`}
      className="grid content-start gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground"
    >
      <header className="grid gap-1">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-4" aria-hidden />
          </span>
          <h3 id={`q-${question.fieldId}`} className="min-w-0 flex-1 text-label text-pretty text-foreground">
            {question.label}
          </h3>
          {action}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 text-caption text-muted-foreground">
          <span className="tabular-nums">{plural(question.answered, 'answer')}</span>
          {question.medianTimeMs !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Timer className="size-3.5" aria-hidden />
              Median time {formatDuration(question.medianTimeMs)}
            </span>
          )}
        </p>
      </header>
      {question.answered === 0 ? <p className="text-body-sm text-muted-foreground">No answers in this period.</p> : children}
    </section>
  )
}

/** Horizontal bars with count and %; each row filters the table. */
export function ChoiceBars({
  options,
  fieldId,
  onFilter,
  limit = 12,
}: {
  options: ChoiceSummaryOption[]
  fieldId: string
  onFilter: SummaryCardProps['onFilter']
  limit?: number
}) {
  const [all, setAll] = useState(false)
  const shown = all ? options : options.slice(0, limit)
  const max = Math.max(1, ...options.map((o) => o.pct))
  return (
    <div className="grid gap-1">
      <ul className="grid gap-1">
        {shown.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onFilter(fieldId, o.id)}
              aria-label={`${o.label}: ${plural(o.count, 'answer')}, ${formatPct(o.pct, o.pct % 1 ? 1 : 0)}. Show these responses`}
              className="focus-ring group grid w-full gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
            >
              <span className="flex items-baseline gap-3 text-body-sm">
                <span className={cn('min-w-0 flex-1 truncate text-foreground', o.deleted && 'text-muted-foreground')}>{o.label}</span>
                <span className="text-muted-foreground tabular-nums">{formatNumber(o.count)}</span>
                <span className="w-12 text-right font-medium text-foreground tabular-nums">{formatPct(o.pct, o.pct % 1 ? 1 : 0)}</span>
              </span>
              <span className="block h-2 overflow-hidden rounded-full bg-progress-track" aria-hidden>
                <span
                  className={cn('block h-full rounded-full bg-chart-1 transition-[width] duration-(--duration-base) group-hover:opacity-85', o.other && 'bg-chart-3', o.deleted && 'bg-chart-6')}
                  style={{ width: `${(o.pct / max) * 100}%` }}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {options.length > limit && (
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${options.length}`}
        </Button>
      )}
    </div>
  )
}

function AnswerList({ items, onOpen }: { items: { responseId: string; submittedAt: string; text: string }[]; onOpen: (id: string) => void }) {
  return (
    <ul className="grid divide-y divide-border rounded-md border border-border">
      {items.map((it) => (
        <li key={it.responseId}>
          <button
            type="button"
            onClick={() => onOpen(it.responseId)}
            className="focus-ring flex w-full items-baseline gap-3 px-3 py-2 text-left text-body-sm hover:bg-accent/60"
          >
            <span className="line-clamp-2 min-w-0 flex-1 break-words whitespace-pre-line text-foreground">{it.text}</span>
            <time className="shrink-0 text-caption text-muted-foreground tabular-nums" dateTime={it.submittedAt}>
              {new Date(it.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </time>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ChoiceCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'choice'>
  return (
    <QuestionCard question={p.question}>
      <ChoiceBars options={d.options} fieldId={p.question.fieldId} onFilter={p.onFilter} limit={p.question.type === 'country' ? 8 : 12} />
      {d.other.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-overline text-muted-foreground">Other answers</h4>
          <AnswerList items={d.other} onOpen={p.onOpenResponse} />
        </div>
      )}
    </QuestionCard>
  )
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-subheading text-foreground tabular-nums">{value}</span>
      {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function RatingCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'rating'>
  const total = d.distribution.reduce((s, x) => s + x.count, 0)
  const options = [...d.distribution].reverse().map((x) => ({
    id: String(x.value),
    label: `${x.value} ${x.value === 1 ? 'star' : 'stars'}`,
    count: x.count,
    pct: total ? Math.round((x.count / total) * 1000) / 10 : 0,
  }))
  return (
    <QuestionCard question={p.question}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-metric text-foreground tabular-nums">{d.average === null ? '–' : d.average.toFixed(1)}</span>
          <span className="text-body text-muted-foreground">/ {d.scale} average</span>
        </div>
        {d.csat !== null && <Metric label="CSAT (4–5 stars)" value={formatPct(d.csat, d.csat % 1 ? 1 : 0)} />}
      </div>
      <ChoiceBars options={options} fieldId={p.question.fieldId} onFilter={p.onFilter} />
    </QuestionCard>
  )
}

const NPS_SWATCH = (v: number) => (v <= 6 ? 'bg-nps-detractor' : v <= 8 ? 'bg-nps-passive' : 'bg-nps-promoter')

export function NpsCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'nps'>
  const max = Math.max(1, ...d.distribution.map((x) => x.count))
  return (
    <QuestionCard question={p.question}>
      <NpsSummaryBar detractors={d.detractors} passives={d.passives} promoters={d.promoters} />
      <div className="grid gap-1.5">
        <h4 className="text-overline text-muted-foreground">Scores 0–10</h4>
        <ol className="grid h-28 grid-cols-11 items-end gap-1">
          {d.distribution.map((x) => (
            <li key={x.value} className="flex h-full flex-col justify-end">
              <button
                type="button"
                onClick={() => p.onFilter(p.question.fieldId, String(x.value))}
                aria-label={`Score ${x.value}: ${plural(x.count, 'answer')}. Show these responses`}
                className="focus-ring group flex h-full flex-col items-center justify-end gap-1 rounded-sm"
              >
                <span className="text-caption text-muted-foreground tabular-nums">{x.count || ''}</span>
                <span
                  className={cn('w-full rounded-t-sm group-hover:opacity-85', NPS_SWATCH(x.value))}
                  style={{ height: `${Math.max(x.count ? 4 : 1, (x.count / max) * 72)}px` }}
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ol>
        <ol className="grid grid-cols-11 gap-1 text-center text-caption text-muted-foreground tabular-nums" aria-hidden>
          {d.distribution.map((x) => (
            <li key={x.value}>{x.value}</li>
          ))}
        </ol>
      </div>
    </QuestionCard>
  )
}

export function NumberCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'number'>
  const f = (n: number | null) => (n === null ? '–' : formatNumber(n))
  return (
    <QuestionCard question={p.question}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Average" value={f(d.average)} />
        <Metric label="Median" value={f(d.median)} />
        <Metric label="Min" value={f(d.min)} />
        <Metric label="Max" value={f(d.max)} />
      </div>
    </QuestionCard>
  )
}

export function LatestCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'latest'>
  return (
    <QuestionCard
      question={p.question}
      action={
        p.question.answered > 0 && (
          <Button variant="ghost" size="sm" className="-my-1.5" onClick={() => p.onViewAll(p.question.fieldId)} aria-label={`View all answers to ${p.question.label}`}>
            View all
            <ArrowRight aria-hidden />
          </Button>
        )
      }
    >
      <div className="grid gap-2">
        <h4 className="text-overline text-muted-foreground">Latest answers</h4>
        <AnswerList items={d.items} onOpen={p.onOpenResponse} />
      </div>
    </QuestionCard>
  )
}

export function CountCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'count'>
  const pct = p.totalResponses ? Math.round((d.count / p.totalResponses) * 100) : 0
  return (
    <QuestionCard question={p.question}>
      <div className="flex items-baseline gap-2">
        <span className="text-metric text-foreground tabular-nums">{formatNumber(d.count)}</span>
        <span className="text-body text-muted-foreground">
          {d.noun} · {pct}% of responses
        </span>
      </div>
    </QuestionCard>
  )
}
