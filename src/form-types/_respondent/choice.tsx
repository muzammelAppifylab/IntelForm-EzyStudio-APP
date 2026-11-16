import {type KeyboardEvent, type ReactNode, useId, useRef} from 'react';

import {inputClass} from '../../respondent/classes';
import {FieldError} from '../../respondent/ui';
import {cx} from '../../respondent/util';
import {LETTERS, OTHER_VALUE, toggleValue} from './constants';
import {FtIcon} from './icons';

/**
 * Respondent choice tiles (legacy src/components/ds/ChoiceOption.tsx), as plain elements with
 * the `ft-*` classes of src/form-types/respondent.css, which follow the form theme's custom
 * properties. A native radio or checkbox sits inside each tile (visually hidden), so forms,
 * labels and arrow keys work without scripting.
 */

export {LETTERS, OTHER_VALUE, toggleValue};

export type ChoiceType = 'radio' | 'checkbox';

export interface ChoiceOptionProps {
  type: ChoiceType;
  name: string;
  value: string;
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Letter key badge (A, B, C…). Shown aria-hidden; exposed as aria-keyshortcuts. */
  letter?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
}

/**
 * One answer tile. Selected: the selected fill, a 2px edge, a filled key badge and a check, so
 * the state never relies on colour alone.
 */
export function ChoiceOption({type, name, value, label, checked, onCheckedChange, letter, disabled, required, invalid}: ChoiceOptionProps) {
  return (
    <label data-state={checked ? 'checked' : 'unchecked'} className="ft-tile ft-tile-row">
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        required={required}
        aria-invalid={type === 'checkbox' && invalid ? true : undefined}
        aria-keyshortcuts={letter}
        onChange={e => onCheckedChange(e.target.checked)}
        className="ft-sr-only"
      />
      {letter && (
        <span aria-hidden className="ft-key">
          {letter}
        </span>
      )}
      <span className="ft-tile-label">{label}</span>
      <FtIcon name="check" className="ft-tile-check" />
    </label>
  );
}

export interface ChoiceItem {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupBase {
  /** The question, rendered as the fieldset legend. */
  legend: ReactNode;
  /** The legend's type class (default `rf-question`), e.g. `rf-question-xl`. */
  legendClassName?: string;
  description?: ReactNode;
  options: ChoiceItem[];
  orientation?: 'vertical' | 'horizontal';
  /** Show A, B, C… badges and select with those keys while focus is inside the group. */
  letterKeys?: boolean;
  /** Adds an "Other" option; when it is selected a text input appears under it. */
  other?: {label?: string; placeholder?: string; text: string; onTextChange: (text: string) => void};
  name?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export type ChoiceGroupProps = ChoiceGroupBase &
  (
    | {type: 'radio'; value: string | null; onChange: (value: string) => void}
    | {type: 'checkbox'; value: string[]; onChange: (value: string[]) => void}
  );

/**
 * A single or multiple choice question: a fieldset + legend of tiles. Radios move with the
 * arrow keys natively; checkboxes get the same movement here.
 */
export function ChoiceGroup(props: ChoiceGroupProps) {
  const {legend, legendClassName, description, options, orientation = 'vertical', letterKeys = true, other, required, disabled, error, className} =
    props;
  const autoId = useId();
  const name = props.name ?? autoId;
  const descId = description ? `${autoId}-desc` : undefined;
  const errId = error ? `${autoId}-err` : undefined;
  const listRef = useRef<HTMLDivElement>(null);

  const items: ChoiceItem[] = other ? [...options, {value: OTHER_VALUE, label: other.label ?? 'Other'}] : options;
  const isChecked = (v: string) => (props.type === 'radio' ? props.value === v : props.value.includes(v));
  const setChecked = (v: string, checked: boolean) => {
    if (props.type === 'radio') {
      if (checked) props.onChange(v);
    } else {
      props.onChange(toggleValue(props.value, v, checked));
    }
  };
  const otherSelected = !!other && isChecked(OTHER_VALUE);

  const onKeyDown = (e: KeyboardEvent<HTMLFieldSetElement>) => {
    const target = e.target as HTMLElement;
    const inOption = target instanceof HTMLInputElement && (target.type === 'radio' || target.type === 'checkbox');
    if (!inOption || e.altKey || e.ctrlKey || e.metaKey) return;

    // Letter keys pick the matching option, only while focus is on one of this group's options.
    if (letterKeys && /^[a-z]$/i.test(e.key)) {
      const index = LETTERS.indexOf(e.key.toUpperCase());
      const item = items[index];
      if (!item || item.disabled || disabled) return;
      e.preventDefault();
      setChecked(item.value, props.type === 'radio' ? true : !isChecked(item.value));
      listRef.current?.querySelectorAll<HTMLInputElement>('input[type=radio],input[type=checkbox]')[index]?.focus();
      return;
    }

    // Arrow keys move between checkboxes the way they move between radios.
    if (props.type === 'checkbox' && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const inputs = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)') ?? []);
      const at = inputs.indexOf(target as HTMLInputElement);
      if (at < 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      inputs[(at + step + inputs.length) % inputs.length]?.focus();
    }
  };

  return (
    <fieldset
      disabled={disabled}
      aria-describedby={[descId, errId].filter(Boolean).join(' ') || undefined}
      onKeyDown={onKeyDown}
      className={cx('ft-group', className)}>
      <legend className={cx('ft-legend', legendClassName ?? 'rf-question')}>
        {legend}
        {required && (
          <span className="rf-required" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      {description && (
        <p id={descId} className="ft-group-description">
          {description}
        </p>
      )}
      <div ref={listRef} className="ft-choice-list" data-orientation={orientation}>
        {items.map((item, i) => (
          <ChoiceOption
            key={item.value}
            type={props.type}
            name={name}
            value={item.value}
            label={item.label}
            letter={letterKeys ? LETTERS[i] : undefined}
            checked={isChecked(item.value)}
            onCheckedChange={c => setChecked(item.value, c)}
            disabled={item.disabled}
            required={props.type === 'radio' ? required : undefined}
            invalid={!!error}
          />
        ))}
      </div>
      {other && otherSelected && (
        <input
          data-slot="input"
          aria-label={other.label ?? 'Other'}
          placeholder={other.placeholder ?? 'Type your answer'}
          value={other.text}
          onChange={e => other.onTextChange(e.target.value)}
          className={inputClass('ft-other-input')}
        />
      )}
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  );
}
