import { useId, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { FieldError } from './FieldError'
import { FORM_FONT, FORM_RADIUS, TILE_BASE, tileState } from './tokens'

export interface NpsScaleProps {
  /** The question, rendered as the fieldset legend. */
  legend: ReactNode
  hideLegend?: boolean
  value: number | null
  onChange: (value: number) => void
  lowLabel?: string
  highLabel?: string
  name?: string
  required?: boolean
  disabled?: boolean
  error?: string
  className?: string
}

const SCORES = Array.from({ length: 11 }, (_, i) => i)

/**
 * The 0–10 Net Promoter question: eleven native radios styled as option tiles with tabular
 * numbers. Below a 480px container the tiles wrap to 0–5 / 6–10 instead of shrinking under 40px.
 * Tiles are never coloured by detractor or promoter, so respondents aren't steered.
 */
export function NpsScale({
  legend,
  hideLegend,
  value,
  onChange,
  lowLabel = 'Not likely',
  highLabel = 'Extremely likely',
  name,
  required,
  disabled,
  error,
  className,
}: NpsScaleProps) {
  const id = useId()
  const errId = error ? `${id}-err` : undefined
  return (
    <fieldset
      data-slot="nps-scale"
      disabled={disabled}
      aria-describedby={errId}
      className={clsx('@container m-0 grid min-w-0 gap-2 border-0 p-0', className)}
    >
      <legend className={clsx('mb-3 p-0 text-question text-foreground', hideLegend && 'sr-only')}>
        {legend}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      <div className="grid grid-cols-11 gap-1 @max-[30rem]:grid-cols-6 @max-[30rem]:gap-2">
        {SCORES.map((n) => {
          const checked = value === n
          return (
            <label
              key={n}
              data-state={checked ? 'checked' : 'unchecked'}
              className={clsx(
                TILE_BASE,
                tileState(checked),
                FORM_RADIUS,
                FORM_FONT,
                'h-(--control-lg) min-w-10 items-center justify-center text-answer font-medium tabular-nums',
              )}
            >
              <input
                type="radio"
                name={name ?? id}
                value={n}
                checked={checked}
                required={required}
                onChange={() => onChange(n)}
                className="sr-only"
              />
              {n}
              {n === 0 && <span className="sr-only">, {lowLabel}</span>}
              {n === 10 && <span className="sr-only">, {highLabel}</span>}
            </label>
          )
        })}
      </div>
      <div className="flex justify-between gap-4 text-caption text-muted-foreground" aria-hidden>
        <span>{lowLabel}</span>
        <span className="text-right">{highLabel}</span>
      </div>
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  )
}
