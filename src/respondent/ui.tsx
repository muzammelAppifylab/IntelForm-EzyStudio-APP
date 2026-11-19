import {type ComponentProps, type ReactNode, useId, useLayoutEffect, useRef} from 'react';

import {formButtonClass, inputClass, type ButtonVariant} from './classes';
import {RIcon} from './icons';
import {RichText} from './rich/RichText';
import {CONTROL, cx, enterToAdvance} from './util';

/**
 * Small respondent-side primitives shared by the field renderers (src/form-types) and the
 * layouts. Native elements with the `rf-*` classes (src/styles/intelform/respondent.css), which
 * follow the form theme through the custom properties FormShell sets on `.rf-theme`. No
 * dashboard kit here: the public form bundle stays small.
 */

type TextInputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string;
  onValueChange: (v: string) => void;
  onAdvance?: () => void;
  invalid?: boolean;
};

/** Themed single-line input with the Enter rule wired in. */
export function TextInput({value, onValueChange, onAdvance, invalid, className, onKeyDown, ...rest}: TextInputProps) {
  return (
    <input
      data-slot="input"
      {...rest}
      value={value}
      aria-invalid={invalid || undefined}
      enterKeyHint={rest.enterKeyHint ?? (onAdvance ? 'next' : undefined)}
      onChange={e => onValueChange(e.target.value)}
      onKeyDown={e => {
        onKeyDown?.(e);
        if (!e.defaultPrevented) enterToAdvance(e, onAdvance);
      }}
      className={inputClass(className)}
    />
  );
}

/** Themed native select (time, address country, plain dropdown). */
export function NativeSelect({className, invalid, ...rest}: ComponentProps<'select'> & {invalid?: boolean}) {
  return (
    <span className={cx('rf-select', className)}>
      <select {...rest} aria-invalid={invalid || undefined} className={cx('rf-input rf-select-control', CONTROL)} />
      <RIcon name="chevron-down" className="rf-select-chevron" />
    </span>
  );
}

/** Error text under a control: danger colour plus an icon, so it never relies on colour alone. */
export function FieldError({id, children}: {id: string; children: string}) {
  return (
    <p id={id} role="alert" className="rf-field-error">
      <RIcon name="alert" className="rf-icon-sm" />
      {children}
    </p>
  );
}

/**
 * Fieldset + legend for group-type fields (name, address, time, consent, signature, picture
 * choice…). The legend holds the question heading.
 */
export function Group({
  legend,
  description,
  error,
  required,
  children,
  className,
  legendClassName,
}: {
  legend: ReactNode;
  description?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** The legend's type class (default `rf-question`), e.g. `rf-question-xl`. */
  legendClassName?: string;
}) {
  const id = useId();
  const descId = description ? `${id}-d` : undefined;
  const errId = error ? `${id}-e` : undefined;
  return (
    <fieldset aria-describedby={[descId, errId].filter(Boolean).join(' ') || undefined} className={cx('rf-group', className)}>
      <legend className={cx('rf-legend', legendClassName ?? 'rf-question')}>
        {legend}
        {required && (
          <span className="rf-required" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      {description && (
        <RichText id={descId} html={description} className="rf-group-description rf-text-body rf-muted" />
      )}
      {children}
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  );
}

/** Small caption label above a sub-input (first name, city…). */
export function SubLabel({htmlFor, children}: {htmlFor: string; children: ReactNode}) {
  return (
    <label htmlFor={htmlFor} className="rf-text-label rf-muted">
      {children}
    </label>
  );
}

/** Themed respondent button: 48px, the theme's button colour and corner shape. */
export function FormButton({className, variant = 'default', ...rest}: ComponentProps<'button'> & {variant?: ButtonVariant}) {
  return <button type="button" data-variant={variant} className={formButtonClass(variant, className)} {...rest} />;
}

/** The same look on a link (the end screen's button). */
export function FormLink({className, variant = 'default', ...rest}: ComponentProps<'a'> & {variant?: ButtonVariant}) {
  return <a data-variant={variant} className={formButtonClass(variant, className)} {...rest} />;
}

/**
 * Respondent progress: a 6px track with the theme's progress fill. The fill width is set
 * through the CSSOM (never a `style=""` attribute: the page's CSP refuses those).
 */
export function ProgressBar({current, total, label, className}: {current: number; total: number; label?: string; className?: string}) {
  const safeTotal = Math.max(0, total);
  const step = Math.min(Math.max(0, current), safeTotal);
  const percent = safeTotal === 0 ? 0 : Math.round((step / safeTotal) * 100);
  const text = label ?? `Question ${step} of ${safeTotal}`;
  const fill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    fill.current?.style.setProperty('width', `${percent}%`);
  }, [percent]);
  return (
    <div className={cx('rf-progress', className)}>
      <div className="rf-progress-meta rf-text-caption rf-muted" aria-hidden>
        <span>{text}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Form progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        className="rf-progress-track"
      >
        <div ref={fill} className="rf-progress-fill" />
      </div>
    </div>
  );
}
