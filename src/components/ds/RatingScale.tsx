import { useId, useState, type ReactNode } from 'react'
import { Annoyed, Frown, Laugh, Meh, Smile, Star, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { FieldError } from './FieldError'
import { FORM_FONT, FORM_RADIUS, TILE_BASE, tileState } from './tokens'

export type RatingVariant = 'stars' | 'numbers' | 'emoji'

export interface RatingScaleProps {
  legend: ReactNode
  hideLegend?: boolean
  value: number | null
  onChange: (value: number) => void
  variant?: RatingVariant
  /** Number of steps, 3–10 (clamped). Default 5. */
  max?: number
  lowLabel?: string
  highLabel?: string
  name?: string
  required?: boolean
  disabled?: boolean
  error?: string
  className?: string
}

/** Five faces, from very unhappy to very happy; scales other than 5 pick the nearest face. */
const FACES: { icon: LucideIcon; label: string }[] = [
  { icon: Frown, label: 'Very unhappy' },
  { icon: Annoyed, label: 'Unhappy' },
  { icon: Meh, label: 'Neutral' },
  { icon: Smile, label: 'Happy' },
  { icon: Laugh, label: 'Very happy' },
]
const faceFor = (step: number, max: number) => FACES[Math.round(((step - 1) / (max - 1)) * (FACES.length - 1))]!

/**
 * Rating question as a native radio group (arrow keys, form semantics). Stars fill with `rating`
 * up to the selected (or hovered) step over `rating-empty`; numbers and faces are option tiles.
 */
export function RatingScale({
  legend,
  hideLegend,
  value,
  onChange,
  variant = 'stars',
  max = 5,
  lowLabel,
  highLabel,
  name,
  required,
  disabled,
  error,
  className,
}: RatingScaleProps) {
  const id = useId()
  const errId = error ? `${id}-err` : undefined
  const steps = Math.min(10, Math.max(3, Math.round(max)))
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0

  const accessibleName = (n: number) =>
    variant === 'stars'
      ? `${n} ${n === 1 ? 'star' : 'stars'}`
      : variant === 'emoji'
        ? `${n} of ${steps}, ${faceFor(n, steps).label}`
        : `${n} of ${steps}`

  return (
    <fieldset
      data-slot="rating-scale"
      disabled={disabled}
      aria-describedby={errId}
      className={clsx('m-0 grid min-w-0 gap-2 border-0 p-0', className)}
    >
      <legend className={clsx('mb-3 p-0 text-question text-foreground', hideLegend && 'sr-only')}>
        {legend}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      <div
        className={clsx('flex flex-wrap', variant === 'stars' ? 'gap-0.5' : 'gap-2')}
        onPointerLeave={() => setHover(null)}
      >
        {Array.from({ length: steps }, (_, i) => i + 1).map((n) => {
          const checked = value === n
          const input = (
            <input
              type="radio"
              name={name ?? id}
              value={n}
              checked={checked}
              required={required}
              aria-label={accessibleName(n)}
              onChange={() => onChange(n)}
              className="sr-only"
            />
          )
          if (variant === 'stars') {
            const filled = n <= shown
            return (
              <label
                key={n}
                data-state={checked ? 'checked' : 'unchecked'}
                onPointerEnter={() => setHover(n)}
                className="group/star grid size-(--control-lg) cursor-pointer place-items-center rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50"
              >
                {input}
                <Star
                  aria-hidden
                  strokeWidth={1.75}
                  className={clsx(
                    'size-8 transition-[color,fill,scale] duration-(--duration-fast) ease-out group-active/star:scale-90',
                    filled ? 'fill-rating text-rating' : 'fill-transparent text-rating-empty',
                    hover === n && 'scale-110 motion-reduce:scale-100',
                    checked && 'animate-pop-in',
                  )}
                />
              </label>
            )
          }
          const Face = variant === 'emoji' ? faceFor(n, steps).icon : null
          return (
            <label
              key={n}
              data-state={checked ? 'checked' : 'unchecked'}
              className={clsx(
                TILE_BASE,
                tileState(checked),
                FORM_RADIUS,
                FORM_FONT,
                'items-center justify-center text-answer font-medium tabular-nums',
                Face ? 'size-14' : 'h-(--control-lg) max-w-16 min-w-10 flex-1',
              )}
            >
              {input}
              {Face ? (
                <Face aria-hidden strokeWidth={1.75} className={clsx('size-7 transition-colors duration-(--duration-fast) ease-out', checked ? 'animate-pop-in text-foreground' : 'text-muted-foreground')} />
              ) : (
                n
              )}
            </label>
          )
        })}
      </div>
      {(lowLabel || highLabel) && (
        <div className="flex justify-between gap-4 text-caption text-muted-foreground" aria-hidden>
          <span>{lowLabel}</span>
          <span className="text-right">{highLabel}</span>
        </div>
      )}
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  )
}
