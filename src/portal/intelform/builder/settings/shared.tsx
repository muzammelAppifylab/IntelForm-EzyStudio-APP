import {type InputHTMLAttributes, type ReactNode, useId} from 'react';

import {Field, Select, ToggleGroup} from '../../../ui';

/**
 * Small building blocks shared by the Design, Settings and Share tabs, made from the kit
 * (`Field`, `Select`, `ToggleGroup`): a titled card with an anchor, a text / number / select
 * row with its label and error in place, and a labelled row of choices.
 */

/** A `card-panel` with an id, so the Settings nav can jump to it. */
export function SettingsCard({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="card-panel if-settings-card">
      <div className="card-head">
        <div>
          <h3 id={`${id}-h`} tabIndex={-1}>
            {title}
          </h3>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      <div className="card-body if-settings-body">{children}</div>
    </section>
  );
}

type TextRowProps = {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  hint?: ReactNode;
  error?: string | null;
  multiline?: boolean;
  rows?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>;

/** A labelled text input (or textarea) with its hint and its error in place. */
export function TextRow({label, value, onChange, onBlur, hint, error, multiline, rows = 3, className, ...rest}: TextRowProps) {
  const own = useId();
  const id = rest.id ?? own;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error ?? undefined}>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={rows}
          maxLength={rest.maxLength}
          placeholder={rest.placeholder}
          disabled={rest.disabled}
          readOnly={rest.readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          {...rest}
          id={id}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )}
    </Field>
  );
}

/** A labelled dropdown (the kit's `Select`). */
export function SelectRow<V extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  error,
  disabled,
}: {
  label: ReactNode;
  value: V | null;
  options: readonly {value: V; label: string}[];
  onChange: (value: V) => void;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const list = value === null || options.some(o => o.value === value) ? [...options] : [{value, label: value}, ...options];
  return (
    <Field id={id} label={label} hint={hint} error={error ?? undefined}>
      <Select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        options={value === null ? [{value: '', label: 'Choose…'}, ...list] : list}
        onChange={e => e.target.value && onChange(e.target.value as V)}
      />
    </Field>
  );
}

/** A visible label over a row of choices (the kit's `ToggleGroup`). */
export function ChoiceRow<V extends string>({
  label,
  description,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  value: V;
  options: {value: V; label: string}[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className="if-choice-row">
      <span className="if-row-label" aria-hidden="true">
        {label}
      </span>
      <ToggleGroup label={label} size="sm" value={value} options={options} disabled={disabled} onChange={onChange} />
      {description && <p className="if-row-hint">{description}</p>}
    </div>
  );
}

/** A small grey line under a group of settings. */
export function Hint({children}: {children: ReactNode}) {
  return <p className="if-row-hint">{children}</p>;
}
