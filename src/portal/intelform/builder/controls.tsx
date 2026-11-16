import {type ComponentProps, type ReactNode, useEffect, useId, useRef, useState} from 'react';

import {type IconName, Notice, Select, Switch, ToggleGroup} from '../../ui';
import {cn} from '../lib/utils';
import './build/controls.css';

/**
 * Small building blocks for the builder's settings panels (dense, about 320px wide) and the
 * Design / Settings / Share tabs. Ported from legacy src/builder/controls.tsx with the same names
 * and props, rebuilt on the portal kit (src/portal/ui): a `.field` for every labelled control,
 * the kit's `Switch`, `ToggleGroup`, `Select` and `Notice`.
 */

export function PanelSection({
  title,
  description,
  children,
  className,
  action,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn('if-panel-section', className)}>
      {(title || action) && (
        <div className="if-panel-section-head">
          <div className="if-panel-section-row">
            {title && <h3 className="if-overline">{title}</h3>}
            {action}
          </div>
          {description && <p className="if-caption">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** An on / off setting that applies at once: the kit's `Switch` with its label and help. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="if-switch-row">
      <Switch label={label} description={description} checked={checked} onChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Label + control + help + error, for one control rendered by `children(id)`. */
export function FieldRow({
  label,
  description,
  error,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  children: (ids: {id: string; describedBy?: string; invalid?: boolean}) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = [description ? `${id}-d` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('field if-field-row', className)} data-invalid={error ? '' : undefined}>
      <label htmlFor={id}>{label}</label>
      {children({id, describedBy, invalid: !!error})}
      {description && (
        <p id={`${id}-d`} className="field-hint">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextRow({
  label,
  description,
  error,
  value,
  onChange,
  multiline,
  ...rest
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  value: string;
  onChange(v: string): void;
  multiline?: boolean;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  return (
    <FieldRow label={label} description={description} error={error}>
      {({id, describedBy, invalid}) =>
        multiline ? (
          <textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={rest.disabled}
            placeholder={rest.placeholder}
            maxLength={rest.maxLength}
            readOnly={rest.readOnly}
            className="if-textarea"
          />
        ) : (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={e => onChange(e.target.value)}
            {...rest}
          />
        )
      }
    </FieldRow>
  );
}

/** Why a number box's text is not acceptable, or null. Exported for tests. */
export function numberError(text: string, {min, max, integer = true}: {min?: number; max?: number; integer?: boolean}): string | null {
  const parsed = text.trim() === '' ? null : Number(text);
  if (parsed === null) return null;
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) return integer ? 'Enter a whole number' : 'Enter a number';
  if (min !== undefined && parsed < min) return `Enter ${min} or more`;
  if (max !== undefined && parsed > max) return `Enter ${max} or less`;
  return null;
}

/** A number box where empty means "no limit" (null). */
export function NumberRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  placeholder = 'No limit',
  disabled,
  integer = true,
}: {
  label: string;
  description?: ReactNode;
  value: number | null;
  onChange(v: number | null): void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  integer?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null ? '' : String(value));
    }
  }, [value]);
  return (
    <TextRow
      label={label}
      description={description}
      error={numberError(text, {min, max, integer})}
      value={text}
      inputMode={integer ? 'numeric' : 'decimal'}
      placeholder={placeholder}
      disabled={disabled}
      onChange={v => {
        setText(v);
        if (numberError(v, {min, max, integer})) return;
        const n = v.trim() === '' ? null : Number(v);
        if (n !== last.current) {
          last.current = n;
          onChange(n);
        }
      }}
      step={step}
    />
  );
}

/** Two to four exclusive choices in a row (the kit's `ToggleGroup`). */
export function SegmentRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  description,
}: {
  label: string;
  value: T;
  options: readonly {value: T; label: string; ariaLabel?: string; icon?: IconName}[];
  onChange(v: T): void;
  disabled?: boolean;
  description?: ReactNode;
}) {
  const iconOnly = options.every(o => o.icon && o.ariaLabel);
  return (
    <div className="if-segment-row">
      <span className="if-label" aria-hidden="true">
        {label}
      </span>
      <ToggleGroup
        label={label}
        size="sm"
        iconOnly={iconOnly}
        disabled={disabled}
        value={value}
        onChange={onChange}
        options={options.map(o => ({value: o.value, label: iconOnly ? (o.ariaLabel ?? o.label) : o.label, icon: o.icon}))}
      />
      {description && <p className="if-caption">{description}</p>}
    </div>
  );
}

/** A labelled dropdown (the kit's `Select`); `null` shows the placeholder until something is picked. */
export function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  description,
}: {
  label: string;
  value: T | null;
  options: readonly {value: T; label: string}[];
  onChange(v: T): void;
  placeholder?: string;
  disabled?: boolean;
  description?: ReactNode;
}) {
  const list = value === null ? [{value: '', label: placeholder ?? 'Choose'}, ...options] : [...options];
  return (
    <FieldRow label={label} description={description}>
      {({id, describedBy}) => (
        <Select
          id={id}
          aria-describedby={describedBy}
          value={value ?? ''}
          disabled={disabled}
          options={list}
          onChange={e => e.target.value && onChange(e.target.value as T)}
        />
      )}
    </FieldRow>
  );
}

/**
 * A label for a `PipeInput` (a contentEditable, which `<label for>` cannot point at): clicking it
 * focuses the editor, and the editor takes the same words as its `ariaLabel`.
 */
export function PipeLabel({htmlFor, children}: {htmlFor: string; children: ReactNode}) {
  return (
    <span className="if-panel-label" onClick={() => document.getElementById(htmlFor)?.focus()}>
      {children}
    </span>
  );
}

/** A short message inside a panel (the kit's `Notice`). */
export function Note({tone = 'info', children, className}: {tone?: 'info' | 'warning' | 'danger'; children: ReactNode; className?: string}) {
  const notice = <Notice tone={tone}>{children}</Notice>;
  return className ? <div className={cn('if-note', className)}>{notice}</div> : notice;
}
