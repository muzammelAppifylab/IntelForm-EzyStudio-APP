import { cn } from '@/components/ui/cn'
import { npsScore } from './nps'

export interface NpsSummaryBarProps {
  /** Counts of answers 0–6, 7–8 and 9–10. */
  detractors: number
  passives: number
  promoters: number
  className?: string
}

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100))

/**
 * Responses summary for an NPS question: the score in `metric`, a stacked bar in the three
 * `nps-*` colours, and a legend that always names each group with its range and share.
 */
export function NpsSummaryBar({ detractors, passives, promoters, className }: NpsSummaryBarProps) {
  const total = detractors + passives + promoters
  const score = npsScore({ detractors, passives, promoters })
  const groups = [
    { key: 'detractors', label: 'Detractors', range: '0–6', count: detractors, swatch: 'bg-nps-detractor' },
    { key: 'passives', label: 'Passives', range: '7–8', count: passives, swatch: 'bg-nps-passive' },
    { key: 'promoters', label: 'Promoters', range: '9–10', count: promoters, swatch: 'bg-nps-promoter' },
  ]
  const summary =
    total === 0
      ? 'No answers yet'
      : `NPS ${score}. ${groups.map((g) => `${pct(g.count, total)}% ${g.label.toLowerCase()}`).join(', ')}`

  return (
    <div data-slot="nps-summary" className={cn('grid gap-3', className)}>
      <div className="flex items-baseline gap-2">
        <span className="text-metric text-foreground">{score === null ? '–' : score > 0 ? `+${score}` : score}</span>
        <span className="text-label text-muted-foreground">NPS</span>
        <span className="ml-auto text-caption text-muted-foreground tabular-nums">
          {total} {total === 1 ? 'answer' : 'answers'}
        </span>
      </div>
      <div role="img" aria-label={summary} className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-progress-track">
        {total > 0 &&
          groups.map((g) =>
            g.count > 0 ? <span key={g.key} className={g.swatch} style={{ flexGrow: g.count, flexBasis: 0 }} /> : null,
          )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground" aria-hidden>
        {groups.map((g) => (
          <li key={g.key} className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', g.swatch)} />
            <span className="text-foreground">{g.label}</span>
            <span>{g.range}</span>
            <span className="font-medium text-foreground tabular-nums">{pct(g.count, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
