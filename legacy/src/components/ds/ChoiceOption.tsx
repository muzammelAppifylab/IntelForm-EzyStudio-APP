import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import { FieldError } from './FieldError'
import { FIELD, FORM_FONT, FORM_RADIUS, INPUT_EXTRA, KEY_SELECTED, LETTERS, TILE_BASE, tileState } from './tokens'

export type ChoiceType = 'radio' | 'checkbox'

export interface ChoiceOptionProps {
  type: ChoiceType
  /** Shared by every option in the group. */
  name: string
  value: string
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Letter key badge (A, B, C…). Shown aria-hidden; exposed to assistive tech as aria-keyshortcuts. */
  letter?: string
  disabled?: boolean
  required?: boolean
  invalid?: boolean
  className?: string
}

/**
 * One answer tile with a native radio or checkbox inside (visually hidden), so forms, labels and
 * arrow keys work without scripting. Rest: `option` fill, 1px `option-border`, `control-lg` tall.
 * Selected: `option-selected` fill, 2px `option-selected-border`, a filled key badge and a check icon,
 * so the state never relies on colour alone. The tile sinks slightly while pressed and the check pops in.
 */
export function ChoiceOption({
  type,
  name,
  value,
  label,
  checked,
  onCheckedChange,
  letter,
  disabled,
  required,
  invalid,
  className,
}: ChoiceOptionProps) {
  return (
    <label
      data-slot="choice-option"
      data-state={checked ? 'checked' : 'unchecked'}
      className={clsx(TILE_BASE, tileState(checked), FORM_RADIUS, FORM_FONT, 'min-h-(--control-lg) items-center gap-3 px-4 py-2.5 text-answer', className)}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        required={required}
        aria-invalid={type === 'checkbox' && invalid ? true : undefined}
        aria-keyshortcuts={letter}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      {letter && (
        <span
          aria-hidden
          className={clsx(
            'grid size-6 shrink-0 place-items-center rounded-sm border text-caption font-medium transition-colors duration-(--duration-fast) ease-out',
            checked ? KEY_SELECTED : 'border-option-border bg-option text-muted-foreground',
          )}
        >
          {letter}
        </span>
      )}
      <span className="min-w-0 flex-1 break-words">{label}</span>
      <Check
        aria-hidden
        strokeWidth={2.5}
        className={clsx('size-4.5 shrink-0 text-[color:var(--form-answer,var(--option-selected-border))]', checked ? 'animate-pop-in' : 'invisible')}
      />
    </label>
  )
}

export interface ChoiceItem {
  value: string
  label: ReactNode
  disabled?: boolean
}

/** Value stored for the "Other" option; its free text travels separately (`other.text`). */
export const OTHER_VALUE = '__other__'

interface ChoiceGroupBase {
  /** The question. Rendered as the fieldset legend. */
  legend: ReactNode
  /** Visually hide the legend (it stays the group's accessible name). */
  hideLegend?: boolean
  /** The legend's type class (default `text-question`), e.g. `text-question-xl`. Replaces the default. */
  legendClassName?: string
  description?: ReactNode
  options: ChoiceItem[]
  orientation?: 'vertical' | 'horizontal'
  /** Show A, B, C… badges and select with those keys while focus is inside the group. Default true. */
  letterKeys?: boolean
  /** Adds an "Other" option; when it is selected a text input appears under it. */
  other?: { label?: string; placeholder?: string; text: string; onTextChange: (text: string) => void }
  name?: string
  required?: boolean
  disabled?: boolean
  error?: string
  className?: string
}

export type ChoiceGroupProps = ChoiceGroupBase &
  (
    | { type: 'radio'; value: string | null; onChange: (value: string) => void }
    | { type: 'checkbox'; value: string[]; onChange: (value: string[]) => void }
  )

/**
 * Single or multiple choice question: a `fieldset` + `legend` of ChoiceOption tiles.
 * Radios move with the arrow keys natively; checkboxes get the same arrow-key movement here.
 */
export function ChoiceGroup(props: ChoiceGroupProps) {
  const {
    legend,
    hideLegend,
    legendClassName,
    description,
    options,
    orientation = 'vertical',
    letterKeys = true,
    other,
    required,
    disabled,
    error,
    className,
  } = props
  const autoId = useId()
  const name = props.name ?? autoId
  const descId = description ? `${autoId}-desc` : undefined
  const errId = error ? `${autoId}-err` : undefined
  const listRef = useRef<HTMLDivElement>(null)

  const items: ChoiceItem[] = other
    ? [...options, { value: OTHER_VALUE, label: other.label ?? 'Other' }]
    : options
  const isChecked = (v: string) => (props.type === 'radio' ? props.value === v : props.value.includes(v))
  const setChecked = (v: string, checked: boolean) => {
    if (props.type === 'radio') {
      if (checked) props.onChange(v)
    } else {
      const next = checked ? [...props.value.filter((x) => x !== v), v] : props.value.filter((x) => x !== v)
      props.onChange(next)
    }
  }
  const otherSelected = !!other && isChecked(OTHER_VALUE)

  const onKeyDown = (e: KeyboardEvent<HTMLFieldSetElement>) => {
    const target = e.target as HTMLElement
    const inOption = target instanceof HTMLInputElement && (target.type === 'radio' || target.type === 'checkbox')
    if (!inOption || e.altKey || e.ctrlKey || e.metaKey) return

    // Letter keys pick the matching option, only while focus is on one of this group's options.
    if (letterKeys && /^[a-z]$/i.test(e.key)) {
      const index = LETTERS.indexOf(e.key.toUpperCase())
      const item = items[index]
      if (!item || item.disabled || disabled) return
      e.preventDefault()
      setChecked(item.value, props.type === 'radio' ? true : !isChecked(item.value))
      listRef.current?.querySelectorAll<HTMLInputElement>('input[type=radio],input[type=checkbox]')[index]?.focus()
      return
    }

    // Arrow keys move between checkboxes the way they move between radios.
    if (props.type === 'checkbox' && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const inputs = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)') ?? [])
      const at = inputs.indexOf(target as HTMLInputElement)
      if (at < 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
      inputs[(at + step + inputs.length) % inputs.length]?.focus()
    }
  }

  return (
    <fieldset
      data-slot="choice-group"
      disabled={disabled}
      aria-describedby={[descId, errId].filter(Boolean).join(' ') || undefined}
      onKeyDown={onKeyDown}
      className={clsx('m-0 grid min-w-0 gap-3 border-0 p-0', className)}
    >
      <legend className={clsx('mb-3 p-0 text-foreground', legendClassName ?? 'text-question', hideLegend && 'sr-only')}>
        {legend}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}*
          </span>
        )}
      </legend>
      {description && (
        <p id={descId} className="-mt-2 text-body-sm text-muted-foreground">
          {description}
        </p>
      )}
      <div
        ref={listRef}
        className={clsx('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap [&>*]:flex-[1_0_auto]')}
      >
        {items.map((item, i) => (
          <ChoiceOption
            key={item.value}
            type={props.type}
            name={name}
            value={item.value}
            label={item.label}
            letter={letterKeys ? LETTERS[i] : undefined}
            checked={isChecked(item.value)}
            onCheckedChange={(c) => setChecked(item.value, c)}
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
          onChange={(e) => other.onTextChange(e.target.value)}
          className={clsx(FIELD, INPUT_EXTRA, 'h-(--control-lg) animate-fade-up px-3 py-1 text-answer', FORM_RADIUS, FORM_FONT)}
        />
      )}
      {error && errId && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  )
}
