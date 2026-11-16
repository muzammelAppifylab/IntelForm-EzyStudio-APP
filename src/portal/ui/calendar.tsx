import {type KeyboardEvent, useEffect, useMemo, useRef, useState} from 'react';

import {IconButton} from './button';
import {Icon} from './icon';
import {Popover} from './popover';

/**
 * A month calendar and a date picker built on it. Dates are plain
 * `YYYY-MM-DD` strings (a calendar day, no time zone), the shape the Site API
 * takes. Keyboard: arrows move a day / a week, Page Up / Down a month, Home /
 * End the week's start / end, Enter or Space picks.
 */

const pad = (n: number) => String(n).padStart(2, '0');
/** `Date` (local) → `YYYY-MM-DD`. */
export const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** `YYYY-MM-DD` → a local `Date` at midnight, or null when it is not a real day. */
export function fromIsoDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toIsoDate(date) === value ? date : null;
}
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const addMonths = (date: Date, months: number) => {
  const last = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), last));
};
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const monthName = (date: Date) => date.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
const dayName = (date: Date) => date.toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});

/** A month grid (weeks start on Monday). `min` / `max` (`YYYY-MM-DD`) disable days outside them. */
export function Calendar({
  value,
  onChange,
  min,
  max,
  label = 'Choose a date',
}: {
  value: string | null;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  label?: string;
}) {
  const selected = fromIsoDate(value);
  const [focus, setFocus] = useState<Date>(() => selected ?? new Date());
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);
  const focusIso = toIsoDate(focus);
  useEffect(() => {
    if (!moved.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusIso}"]`)?.focus();
  }, [focusIso]);

  const weeks = useMemo(() => {
    const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({length: 6}, (_, w) => Array.from({length: 7}, (_, d) => addDays(start, w * 7 + d)));
  }, [focus]);
  const outOfRange = (iso: string) => Boolean((min && iso < min) || (max && iso > max));
  const today = toIsoDate(new Date());

  const move = (to: Date) => {
    moved.current = true;
    setFocus(to);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const map: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1),
      PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, -((focus.getDay() + 6) % 7)),
      End: () => addDays(focus, 6 - ((focus.getDay() + 6) % 7)),
    };
    const next = map[event.key];
    if (!next) return;
    event.preventDefault();
    move(next());
  };

  return (
    <div className="calendar">
      <div className="calendar-head">
        <IconButton icon="chevron-left" label="Previous month" variant="ghost" size="sm" onClick={() => setFocus(addMonths(focus, -1))} />
        <p className="calendar-month" aria-live="polite">
          {monthName(focus)}
        </p>
        <IconButton icon="chevron-right" label="Next month" variant="ghost" size="sm" onClick={() => setFocus(addMonths(focus, 1))} />
      </div>
      <table ref={grid} className="calendar-grid" role="grid" aria-label={`${label}, ${monthName(focus)}`} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {WEEKDAYS.map(day => (
              <th key={day} scope="col" abbr={day}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => (
            <tr key={toIsoDate(week[0]!)}>
              {week.map(day => {
                const iso = toIsoDate(day);
                const disabled = outOfRange(iso);
                return (
                  <td key={iso} role="gridcell" aria-selected={iso === value}>
                    <button
                      type="button"
                      className="calendar-day"
                      data-day={iso}
                      data-outside={day.getMonth() !== focus.getMonth() ? '' : undefined}
                      data-today={iso === today ? '' : undefined}
                      aria-pressed={iso === value}
                      aria-label={dayName(day)}
                      tabIndex={iso === focusIso ? 0 : -1}
                      disabled={disabled}
                      onClick={() => {
                        setFocus(day);
                        onChange(iso);
                      }}>
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A date field: a button showing the date (or the placeholder) that opens a
 * `Calendar` in a popover. Pass `Field`'s id so its label names the button.
 * `clearable` adds a "Clear" action that calls `onChange(null)`.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  clearable,
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const date = fromIsoDate(value);
  const text = date ? date.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : placeholder;
  return (
    <span className="date-picker">
      <Popover
        label="Choose a date"
        open={open}
        onOpenChange={setOpen}
        wide
        triggerId={id}
        disabled={disabled}
        triggerClassName="combobox-trigger"
        trigger={
          <>
            <Icon name="calendar" size={16} />
            <span className={date ? 'combobox-value' : 'combobox-value combobox-placeholder'}>{text}</span>
          </>
        }>
        <Calendar
          value={value}
          min={min}
          max={max}
          onChange={next => {
            onChange(next);
            setOpen(false);
          }}
        />
        {clearable && value && (
          <div className="calendar-foot">
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}>
              Clear
            </button>
          </div>
        )}
      </Popover>
    </span>
  );
}
