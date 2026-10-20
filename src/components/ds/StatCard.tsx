import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/components/ui/cn'

export interface StatDelta {
  /** Display text, e.g. "12%" or "4". The sign comes from `trend`. */
  value: string
  trend: 'up' | 'down' | 'flat'
  /** Whether "up" is good for this metric (default true). Drop-off rate passes false. */
  upIsGood?: boolean
  /** Comparison period, e.g. "vs last 7 days". */
  period?: string
}

export interface StatCardProps {
  label: string
  value: ReactNode
  delta?: StatDelta
  icon?: LucideIcon
  /** One-line context under the value. */
  description?: ReactNode
  className?: string
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const
const TREND_WORD = { up: 'Up', down: 'Down', flat: 'No change,' } as const

/** KPI tile: label, value in `metric` (tabular), optional delta that pairs colour with an arrow and a word. */
export function StatCard({ label, value, delta, icon: Icon, description, className }: StatCardProps) {
  const good = delta && delta.trend !== 'flat' && (delta.trend === 'up') === (delta.upIsGood ?? true)
  const DeltaIcon = delta ? TREND_ICON[delta.trend] : null
  return (
    <div data-slot="stat-card" className={cn('grid gap-2 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
      </div>
      <div className="text-metric text-foreground">{value}</div>
      {(delta || description) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          {delta && DeltaIcon && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium tabular-nums',
                delta.trend === 'flat' ? 'text-muted-foreground' : good ? 'text-pine' : 'text-destructive',
              )}
            >
              <DeltaIcon className="size-3.5" aria-hidden />
              <span className="sr-only">{TREND_WORD[delta.trend]} </span>
              {delta.value}
            </span>
          )}
          {delta?.period && <span>{delta.period}</span>}
          {description && <span>{description}</span>}
        </div>
      )}
    </div>
  )
}
