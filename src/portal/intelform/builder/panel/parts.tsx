import {type ReactNode, useEffect, useId, useRef, useState} from 'react';

import {Field, Notice, Switch} from '../../../ui';
import {parseNumberText} from './model';
import './panel.css';

/**
 * Small building blocks for the builder's settings panel (dense, about 320px wide), on the
 * template kit: kit `Field` for label + hint + error, kit `Switch` for on/off settings that
 * apply at once, kit `Notice` for notes. Legacy: src/builder/controls.tsx.
 */

export function PanelSection({
  title,
  description,
  action,
  children,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="if-panel-section" aria-labelledby={title ? id : undefined}>
      {(title || action) && (
        <div className="if-panel-section-head">
          <div className="if-panel-section-title">
            {title && <h3 id={id}>{title}</h3>}
            {action}
          </div>
          {description && <p className="if-panel-hint">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** An on/off setting that applies at once (kit `Switch`). */
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
  return <Switch label={label} description={description} checked={checked} onChange={onCheckedChange} disabled={disabled} />;
}

/** A text box with its label, hint and error in place (kit `Field`). */
export function TextRow({
  label,
  description,
  error,
  value,
  onChange,
  multiline,
  maxLength,
  placeholder,
  disabled,
  type = 'text',
  inputMode,
}: {
  label: string;
  description?: ReactNode;
  error?: string | null;
  value: string;
  onChange(v: string): void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'url';
  inputMode?: 'numeric' | 'decimal';
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : description ? `${id}-hint` : undefined;
  const common = {
    id,
    value,
    maxLength,
    placeholder,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };
  return (
    <Field label={label} hint={description} error={error ?? undefined} id={id}>
      {multiline ? (
        <textarea {...common} rows={3} onChange={e => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} inputMode={inputMode} onChange={e => onChange(e.target.value)} />
      )}
    </Field>
  );
}

/** A number box where empty means "none" (null); only valid numbers are saved. */
export function NumberRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
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
  const {error} = parseNumberText(text, {min, max, integer});
  return (
    <TextRow
      label={label}
      description={description}
      error={error}
      value={text}
      inputMode={integer ? 'numeric' : 'decimal'}
      placeholder={placeholder}
      disabled={disabled}
      onChange={v => {
        setText(v);
        const parsed = parseNumberText(v, {min, max, integer});
        if (parsed.value !== undefined && parsed.value !== last.current) {
          last.current = parsed.value;
          onChange(parsed.value);
        }
      }}
    />
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

export function Note({tone = 'info', children}: {tone?: 'info' | 'warning' | 'danger'; children: ReactNode}) {
  return <Notice tone={tone}>{children}</Notice>;
}
