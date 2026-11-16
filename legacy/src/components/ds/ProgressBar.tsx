import { clsx } from 'clsx'

export interface ProgressBarProps {
  /** Current step, 1-based. Clamped to 0…total. */
  current: number
  /** Steps that can be shown (exclude questions hidden by logic). */
  total: number
  /** Visible label. Defaults to "Question {current} of {total}"; paged forms pass "Step 2 of 4". */
  label?: string
  /** Hide the visible label (it stays as aria-valuetext). */
  hideLabel?: boolean
  showPercent?: boolean
  labelPosition?: 'top' | 'bottom'
  className?: string
}

/**
 * Respondent progress: 6px `progress-track` with a coral `progress` fill (`--form-progress` inside a
 * themed form), `radius-full`, width animating over 320ms ease-out and instantly under reduced motion.
 * This is the one coral element on a respondent screen.
 */
export function ProgressBar({
  current,
  total,
  label,
  hideLabel,
  showPercent,
  labelPosition = 'top',
  className,
}: ProgressBarProps) {
  const safeTotal = Math.max(0, total)
  const step = Math.min(Math.max(0, current), safeTotal)
  const percent = safeTotal === 0 ? 0 : Math.round((step / safeTotal) * 100)
  const text = label ?? `Question ${step} of ${safeTotal}`
  const meta = !hideLabel && (
    <div className="flex justify-between gap-4 text-caption font-medium text-muted-foreground tabular-nums" aria-hidden>
      <span>{text}</span>
      {showPercent && <span>{percent}%</span>}
    </div>
  )
  return (
    <div data-slot="progress-bar" className={clsx('grid gap-2', className)}>
      {labelPosition === 'top' && meta}
      <div
        role="progressbar"
        aria-label="Form progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        className="h-1.5 overflow-hidden rounded-full bg-progress-track"
      >
        <div
          className="h-full rounded-full bg-[var(--form-progress,var(--progress))] transition-[width] duration-(--duration-slow) ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      {labelPosition === 'bottom' && meta}
    </div>
  )
}
