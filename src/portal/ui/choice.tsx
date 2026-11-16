import {type KeyboardEvent, type ReactNode, useId, useRef, useState} from 'react';

import {Icon, type IconName} from './icon';

/**
 * More ways to choose: `RadioGroup` (a plain list of radios), `ToggleGroup`
 * (icon or word buttons: alignment, layout, bold / italic), `Slider` (a number
 * in a range), and IntelForm's answer scales, `NpsScale` and `RatingScale`,
 * which also SHOW an answer read-only (no `onChange`), plus `NpsSummaryBar`.
 * Native inputs underneath, so arrow keys and screen readers work as expected.
 */

// ------------------------------------------------------------- radio group --

/** Radios in a list, for choices that need no explanation each (else `RadioCards`). */
export function RadioGroup<V extends string>({
  legend,
  hideLegend,
  name,
  value,
  onChange,
  options,
  inline,
  error,
  disabled,
}: {
  legend: ReactNode;
  hideLegend?: boolean;
  name?: string;
  value: V | null;
  onChange: (value: V) => void;
  options: {value: V; label: ReactNode; description?: ReactNode; disabled?: boolean}[];
  /** Side by side instead of stacked (two or three short options). */
  inline?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="radio-group" disabled={disabled} aria-describedby={error ? `${id}-error` : undefined} data-inline={inline ? '' : undefined}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className="radio-group-items">
        {options.map(option => (
          <label key={option.value} className="checkbox radio" data-disabled={option.disabled ? '' : undefined}>
            <input
              type="radio"
              name={name ?? id}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>
              <span className="checkbox-label">{option.label}</span>
              {option.description && <span className="checkbox-description">{option.description}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ------------------------------------------------------------ toggle group --

type ToggleOption<V extends string> = {value: V; label: string; icon?: IconName; disabled?: boolean};

/**
 * A row of pressed / not-pressed buttons. Single (`value: V`, one is always
 * on, arrow keys move, like `SegmentedControl` but for TOOLS: alignment, a
 * layout) or `multiple` (`value: V[]`: bold, italic, underline). With `icon`
 * and `iconOnly`, the label becomes the button's accessible name.
 */
export function ToggleGroup<V extends string>(
  props: {
    label: string;
    options: ToggleOption<V>[];
    iconOnly?: boolean;
    size?: 'sm' | 'md';
    disabled?: boolean;
  } & ({multiple?: false; value: V; onChange: (value: V) => void} | {multiple: true; value: V[]; onChange: (value: V[]) => void})
) {
  const {label, options, iconOnly, size = 'md', disabled} = props;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isOn = (v: V) => (props.multiple ? props.value.includes(v) : props.value === v);
  const press = (v: V) => {
    if (props.multiple) props.onChange(props.value.includes(v) ? props.value.filter(x => x !== v) : [...props.value, v]);
    else props.onChange(v);
  };
  const current = Math.max(0, options.findIndex(option => isOn(option.value)));
  const onKeyDown = (event: KeyboardEvent, i: number) => {
    const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
    if (!step) return;
    event.preventDefault();
    const to = (i + step + options.length) % options.length;
    refs.current[to]?.focus();
    if (!props.multiple) press(options[to]!.value);
  };
  return (
    <div
      className={`toggle-group toggle-group-${size}`}
      role={props.multiple ? 'group' : 'radiogroup'}
      aria-label={label}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={node => {
            refs.current[i] = node;
          }}
          type="button"
          className="toggle"
          role={props.multiple ? undefined : 'radio'}
          aria-checked={props.multiple ? undefined : isOn(option.value)}
          aria-pressed={props.multiple ? isOn(option.value) : undefined}
          aria-label={iconOnly ? option.label : undefined}
          title={iconOnly ? option.label : undefined}
          tabIndex={props.multiple || i === current ? 0 : -1}
          disabled={disabled || option.disabled}
          onClick={() => press(option.value)}
          onKeyDown={event => onKeyDown(event, i)}>
          {option.icon && <Icon name={option.icon} size={16} />}
          {!iconOnly && option.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ slider --

/** A number in a range (corner radius, a font size): a native range input and its value. */
export function Slider({
  id,
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  format = String,
  disabled,
}: {
  id?: string;
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** How the value reads ("12 px"); also its `aria-valuetext`. */
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const own = useId();
  const inputId = id ?? own;
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={inputId}>{label}</label>
        <output htmlFor={inputId} className="slider-value">
          {format(value)}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={event => onChange(Number(event.target.value))}
      />
    </div>
  );
}

// ------------------------------------------------------------------- scales --

const SCORES = Array.from({length: 11}, (_, i) => i);

/**
 * The 0–10 "How likely are you to recommend…" scale. With `onChange`: eleven
 * radios styled as tiles (never coloured by group, so nobody is steered).
 * Without: the given answer, read-only.
 */
export function NpsScale({
  legend,
  hideLegend,
  value,
  onChange,
  lowLabel = 'Not likely',
  highLabel = 'Extremely likely',
  name,
}: {
  legend: ReactNode;
  hideLegend?: boolean;
  value: number | null;
  onChange?: (value: number) => void;
  lowLabel?: string;
  highLabel?: string;
  name?: string;
}) {
  const id = useId();
  const readOnly = !onChange;
  return (
    <fieldset className="scale nps-scale" data-readonly={readOnly ? '' : undefined}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      {readOnly && <span className="visually-hidden">{value === null ? 'No answer' : `Answered ${value} out of 10`}</span>}
      <div className="nps-scale-tiles" aria-hidden={readOnly || undefined}>
        {SCORES.map(n => (
          <label key={n} className="scale-tile" data-checked={value === n ? '' : undefined}>
            {!readOnly && (
              <input type="radio" className="visually-hidden" name={name ?? id} value={n} checked={value === n} onChange={() => onChange(n)} />
            )}
            {n}
            {n === 0 && <span className="visually-hidden">, {lowLabel}</span>}
            {n === 10 && <span className="visually-hidden">, {highLabel}</span>}
          </label>
        ))}
      </div>
      <div className="scale-ends" aria-hidden="true">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </fieldset>
  );
}

export type RatingVariant = 'stars' | 'numbers' | 'emoji';
const FACES: {icon: IconName; label: string}[] = [
  {icon: 'frown', label: 'Very unhappy'},
  {icon: 'annoyed', label: 'Unhappy'},
  {icon: 'meh', label: 'Neutral'},
  {icon: 'smile', label: 'Happy'},
  {icon: 'laugh', label: 'Very happy'},
];
/** The face for step `n` of `max` (scales other than 5 pick the nearest face). */
export const faceFor = (n: number, max: number) => FACES[Math.round(((n - 1) / Math.max(1, max - 1)) * (FACES.length - 1))]!;

/**
 * A 3–10 step rating as stars, numbers or faces. With `onChange`: native
 * radios (arrow keys). Without: the given answer, read-only, as one image with
 * its words ("4 of 5 stars").
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
}: {
  legend: ReactNode;
  hideLegend?: boolean;
  value: number | null;
  onChange?: (value: number) => void;
  variant?: RatingVariant;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
  name?: string;
}) {
  const id = useId();
  const steps = Math.min(10, Math.max(3, Math.round(max)));
  const [hover, setHover] = useState<number | null>(null);
  const readOnly = !onChange;
  const shown = (readOnly ? null : hover) ?? value ?? 0;
  const nameOf = (n: number) =>
    variant === 'stars' ? `${n} ${n === 1 ? 'star' : 'stars'}` : variant === 'emoji' ? `${n} of ${steps}, ${faceFor(n, steps).label}` : `${n} of ${steps}`;
  return (
    <fieldset className={`scale rating-scale rating-${variant}`} data-readonly={readOnly ? '' : undefined}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      {readOnly && <span className="visually-hidden">{value === null ? 'No answer' : `${nameOf(value)} out of ${steps}`}</span>}
      <div className="rating-items" aria-hidden={readOnly || undefined} onPointerLeave={() => setHover(null)}>
        {Array.from({length: steps}, (_, i) => i + 1).map(n => {
          const checked = value === n;
          return (
            <label
              key={n}
              className={variant === 'stars' ? 'rating-star' : 'scale-tile'}
              data-checked={checked ? '' : undefined}
              data-filled={variant === 'stars' && n <= shown ? '' : undefined}
              onPointerEnter={() => setHover(n)}>
              {!readOnly && (
                <input
                  type="radio"
                  className="visually-hidden"
                  name={name ?? id}
                  value={n}
                  checked={checked}
                  aria-label={nameOf(n)}
                  onChange={() => onChange(n)}
                />
              )}
              {variant === 'stars' ? (
                <Icon name="star" size={readOnly ? 20 : 32} />
              ) : variant === 'emoji' ? (
                <Icon name={faceFor(n, steps).icon} size={readOnly ? 20 : 24} />
              ) : (
                n
              )}
            </label>
          );
        })}
      </div>
      {(lowLabel || highLabel) && (
        <div className="scale-ends" aria-hidden="true">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </fieldset>
  );
}

// -------------------------------------------------------------- NPS summary --

export type NpsCounts = {detractors: number; passives: number; promoters: number};

/** Which NPS group a 0–10 answer falls in. */
export const npsGroup = (score: number): keyof NpsCounts => (score <= 6 ? 'detractors' : score <= 8 ? 'passives' : 'promoters');

/** NPS = % promoters − % detractors, rounded; null with no answers. */
export function npsScore({detractors, passives, promoters}: NpsCounts) {
  const total = detractors + passives + promoters;
  return total === 0 ? null : Math.round(((promoters - detractors) / total) * 100);
}

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

/** An NPS question's summary: the score, a stacked bar in the three group colours, a legend with words and shares. */
export function NpsSummaryBar({detractors, passives, promoters}: NpsCounts) {
  const total = detractors + passives + promoters;
  const score = npsScore({detractors, passives, promoters});
  const groups = [
    {key: 'detractors', label: 'Detractors', range: '0–6', count: detractors},
    {key: 'passives', label: 'Passives', range: '7–8', count: passives},
    {key: 'promoters', label: 'Promoters', range: '9–10', count: promoters},
  ] as const;
  const summary = total === 0 ? 'No answers yet' : `NPS ${score}. ${groups.map(g => `${pct(g.count, total)}% ${g.label.toLowerCase()}`).join(', ')}`;
  let x = 0;
  return (
    <div className="nps-summary">
      <div className="nps-summary-head">
        <span className="nps-summary-score">{score === null ? '–' : score > 0 ? `+${score}` : score}</span>
        <span className="muted">NPS</span>
        <span className="nps-summary-total">
          {total} {total === 1 ? 'answer' : 'answers'}
        </span>
      </div>
      <svg className="nps-summary-bar" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label={summary}>
        <rect className="progress-track" width="100" height="4" rx="2" />
        {total > 0 &&
          groups.map(g => {
            const width = (g.count / total) * 100;
            const rect = width > 0 ? <rect key={g.key} className={`nps-${g.key}`} x={x} width={width} height="4" /> : null;
            x += width;
            return rect;
          })}
      </svg>
      <ul className="nps-summary-legend" aria-hidden="true">
        {groups.map(g => (
          <li key={g.key}>
            <span className={`nps-swatch nps-${g.key}`} />
            <span className="nps-summary-label">{g.label}</span>
            <span className="muted">{g.range}</span>
            <span className="nps-summary-pct">{pct(g.count, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
