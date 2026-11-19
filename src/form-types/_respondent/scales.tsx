import {type ReactNode, useId, useState} from 'react';

import {FieldError} from '../../respondent/ui';
import {cx} from '../../respondent/util';
import {FtIcon, type FtIconName} from './icons';

/**
 * Respondent NPS and rating scales (legacy src/components/ds/{NpsScale,RatingScale}.tsx) as
 * native radio groups with the `ft-*` classes. Tiles are never coloured by detractor or
 * promoter, so respondents aren't steered.
 */

const SCORES = Array.from({length: 11}, (_, i) => i);

export function NpsScale({
  legend,
  legendClassName,
  value,
  onChange,
  lowLabel = 'Not likely',
  highLabel = 'Extremely likely',
  name,
  required,
  error,
}: {
  legend: ReactNode;
  legendClassName?: string;
  value: number | null;
  onChange: (value: number) => void;
  lowLabel?: string;
  highLabel?: string;
  name?: string;
  required?: boolean;
  error?: string;
}) {
  const id = useId();
  const errId = error ? `${id}-err` : undefined;
  return (
    <fieldset aria-describedby={errId} className="ft-group ft-scale">
      <legend className={cx('ft-legend', legendClassName ?? 'rf-question')}>
        {legend}
        {required && (
          <span className="rf-required" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      <div className="ft-nps-grid">
        {SCORES.map(n => {
          const checked = value === n;
          return (
            <label
              key={n}
              data-state={checked ? 'checked' : 'unchecked'}
              data-below={value !== null && n < value ? '' : undefined}
              className="ft-tile ft-tile-score">
              <input
                type="radio"
                name={name ?? id}
                value={n}
                checked={checked}
                required={required}
                onChange={() => onChange(n)}
                className="ft-sr-only"
              />
              {n}
              {n === 0 && <span className="ft-sr-only">, {lowLabel}</span>}
              {n === 10 && <span className="ft-sr-only">, {highLabel}</span>}
            </label>
          );
        })}
      </div>
      <div className="ft-scale-ends" aria-hidden>
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  );
}

export type RatingVariant = 'stars' | 'numbers' | 'emoji';

/** Five faces, from very unhappy to very happy; scales other than 5 pick the nearest face. */
const FACES: {icon: FtIconName; label: string}[] = [
  {icon: 'frown', label: 'Very unhappy'},
  {icon: 'annoyed', label: 'Unhappy'},
  {icon: 'meh', label: 'Neutral'},
  {icon: 'smile', label: 'Happy'},
  {icon: 'laugh', label: 'Very happy'},
];

export const faceFor = (step: number, max: number) => FACES[Math.round(((step - 1) / Math.max(1, max - 1)) * (FACES.length - 1))]!;

/** Clamp a rating scale to 3–10 steps. */
export const ratingSteps = (max: number) => Math.min(10, Math.max(3, Math.round(max)));

/** The accessible name of one rating step. */
export function ratingStepName(n: number, steps: number, variant: RatingVariant): string {
  if (variant === 'stars') return `${n} ${n === 1 ? 'star' : 'stars'}`;
  if (variant === 'emoji') return `${n} of ${steps}, ${faceFor(n, steps).label}`;
  return `${n} of ${steps}`;
}

/**
 * Rating question: stars fill up to the selected (or hovered) step; numbers and faces are
 * option tiles.
 */
export function RatingScale({
  legend,
  legendClassName,
  value,
  onChange,
  variant = 'stars',
  max = 5,
  lowLabel,
  highLabel,
  name,
  required,
  error,
}: {
  legend: ReactNode;
  legendClassName?: string;
  value: number | null;
  onChange: (value: number) => void;
  variant?: RatingVariant;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
  name?: string;
  required?: boolean;
  error?: string;
}) {
  const id = useId();
  const errId = error ? `${id}-err` : undefined;
  const steps = ratingSteps(max);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <fieldset aria-describedby={errId} className="ft-group ft-scale">
      <legend className={cx('ft-legend', legendClassName ?? 'rf-question')}>
        {legend}
        {required && (
          <span className="rf-required" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      <div className="ft-rating-row" data-variant={variant} onPointerLeave={() => setHover(null)}>
        {Array.from({length: steps}, (_, i) => i + 1).map(n => {
          const checked = value === n;
          const input = (
            <input
              type="radio"
              name={name ?? id}
              value={n}
              checked={checked}
              required={required}
              aria-label={ratingStepName(n, steps, variant)}
              onChange={() => onChange(n)}
              className="ft-sr-only"
            />
          );
          if (variant === 'stars') {
            return (
              <label
                key={n}
                data-state={checked ? 'checked' : 'unchecked'}
                data-filled={n <= shown ? '' : undefined}
                data-hover={hover === n ? '' : undefined}
                onPointerEnter={() => setHover(n)}
                className="ft-star">
                {input}
                <FtIcon name="star" className="ft-star-icon" />
              </label>
            );
          }
          return (
            <label
              key={n}
              data-state={checked ? 'checked' : 'unchecked'}
              className={cx('ft-tile', variant === 'emoji' ? 'ft-tile-face' : 'ft-tile-score ft-tile-number')}>
              {input}
              {variant === 'emoji' ? <FtIcon name={faceFor(n, steps).icon} className="ft-face-icon" /> : n}
            </label>
          );
        })}
      </div>
      {(lowLabel || highLabel) && (
        <div className="ft-scale-ends" aria-hidden>
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  );
}
