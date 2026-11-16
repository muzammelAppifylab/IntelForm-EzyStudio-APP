import {useMemo} from 'react';

import {OTHER_OPTION_ID} from '../../../lib/intelform/form/definition';
import {COUNTRY_CODES, countryName} from '../../../lib/intelform/form/types/registry';
import {Select} from '../../ui';
import type {ConditionValueProps} from './type-ui';
import './build/controls.css';

/**
 * Value inputs for logic conditions, shared by the per-type ConditionValue files
 * (src/form-types/<type>/ConditionValue.tsx). Compact controls on the kit's tokens; dropdowns are
 * the kit's `Select` with a "Pick…" placeholder until a value is chosen.
 */

const INPUT = 'if-input if-input-sm';

/** The text a number box turns into a condition value: a number when it is one, else the raw text. Exported for tests. */
export function parseNumberValue(text: string): number | string | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && /^-?\d*\.?\d+$/.test(t) ? n : t;
}

export function TextValue({
  value,
  onChange,
  label,
  readOnly,
  placeholder = 'Text',
  invalid,
  inputMode,
}: ConditionValueProps & {placeholder?: string; invalid?: boolean; inputMode?: 'text' | 'tel'}) {
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={INPUT}
      value={value === undefined ? '' : String(value)}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={500}
      readOnly={readOnly}
    />
  );
}

export function NumberValue({value, onChange, label, readOnly}: ConditionValueProps) {
  return (
    <input
      aria-label={label}
      className={INPUT}
      inputMode="decimal"
      value={value === undefined ? '' : String(value)}
      onChange={e => onChange(parseNumberValue(e.target.value))}
      placeholder="Number"
      readOnly={readOnly}
    />
  );
}

function PickSelect({
  label,
  value,
  placeholder,
  options,
  onPick,
  readOnly,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  options: {value: string; label: string}[];
  onPick(v: string): void;
  readOnly?: boolean;
}) {
  const list = value === undefined || !options.some(o => o.value === value) ? [{value: '', label: placeholder}, ...options] : options;
  return (
    <span className="if-select-sm">
      <Select aria-label={label} value={value ?? ''} disabled={readOnly} options={list} onChange={e => e.target.value && onPick(e.target.value)} />
    </span>
  );
}

export function ScaleValue({value, onChange, label, readOnly, from, to}: ConditionValueProps & {from: number; to: number}) {
  const items = Array.from({length: to - from + 1}, (_, i) => String(from + i));
  return (
    <PickSelect
      label={label}
      readOnly={readOnly}
      value={value === undefined ? undefined : String(value)}
      placeholder="Pick"
      options={items.map(v => ({value: v, label: v}))}
      onPick={v => onChange(Number(v))}
    />
  );
}

export function DateValue({value, onChange, label, readOnly}: ConditionValueProps) {
  return (
    <input
      type="date"
      aria-label={label}
      className={INPUT}
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value || undefined)}
      readOnly={readOnly}
    />
  );
}

export function TimeValue({value, onChange, label, readOnly}: ConditionValueProps) {
  return (
    <input
      type="time"
      aria-label={label}
      className={INPUT}
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value || undefined)}
      readOnly={readOnly}
    />
  );
}

export function OptionValue({
  value,
  onChange,
  label,
  readOnly,
  options,
  other,
}: ConditionValueProps & {options: readonly {id: string; label: string}[]; other?: boolean}) {
  const items = other ? [...options, {id: OTHER_OPTION_ID, label: 'Other'}] : options;
  return (
    <PickSelect
      label={label}
      readOnly={readOnly}
      value={typeof value === 'string' ? value : undefined}
      placeholder="Pick an option"
      options={items.map((o, i) => ({value: o.id, label: o.label || `Option ${i + 1}`}))}
      onPick={v => onChange(v)}
    />
  );
}

export function CountryValue({value, onChange, label, readOnly, limitTo}: ConditionValueProps & {limitTo?: readonly string[]}) {
  const items = useMemo(
    () =>
      (limitTo?.length ? limitTo : COUNTRY_CODES)
        .map(c => ({value: c, label: countryName(c)}))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [limitTo]
  );
  return (
    <PickSelect
      label={label}
      readOnly={readOnly}
      value={typeof value === 'string' ? value : undefined}
      placeholder="Pick a country"
      options={items}
      onPick={v => onChange(v)}
    />
  );
}
