import {type KeyboardEvent, useEffect, useMemo, useRef, useState} from 'react';

import {cx} from '../../respondent/util';
import {FtIcon} from '../_respondent/icons';
import {addDays, fromIso, isDayAllowed, monthGrid, toIso} from './mask';

/**
 * The date field's calendar popover body (legacy: react-day-picker, loaded on first open). A
 * small month grid of buttons: month and year selects, previous / next month, arrow keys move
 * by day / week, PageUp / PageDown by month, Home / End to the week's ends, Enter picks.
 * Loaded lazily by the date renderer, so it costs nothing until the calendar is opened.
 */
export default function DateCalendar({
  selected,
  onSelect,
  minDate,
  maxDate,
  disablePast,
  disableFuture,
}: {
  selected: string | null;
  onSelect: (iso: string) => void;
  minDate: string | null;
  maxDate: string | null;
  disablePast: boolean;
  disableFuture: boolean;
}) {
  const today = toIso(new Date());
  const limits = {minDate, maxDate, disablePast, disableFuture};
  const start = selected ?? (minDate && minDate > today ? minDate : today);
  const [focus, setFocus] = useState(start);
  const view = fromIso(focus);
  const year = view.getFullYear();
  const month = view.getMonth();
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  const locale = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined;
  const monthNames = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, {month: 'long'});
    return Array.from({length: 12}, (_, m) => f.format(new Date(2000, m, 1)));
  }, [locale]);
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, {weekday: 'narrow'});
    const long = new Intl.DateTimeFormat(locale, {weekday: 'long'});
    // 2024-01-01 was a Monday.
    return Array.from({length: 7}, (_, i) => ({short: short.format(new Date(2024, 0, 1 + i)), long: long.format(new Date(2024, 0, 1 + i))}));
  }, [locale]);
  const dayName = useMemo(() => new Intl.DateTimeFormat(locale, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}), [locale]);

  const thisYear = new Date().getFullYear();
  const firstYear = minDate ? fromIso(minDate).getFullYear() : thisYear - 120;
  const lastYear = maxDate ? fromIso(maxDate).getFullYear() : thisYear + 20;
  const years = Array.from({length: Math.max(1, lastYear - firstYear + 1)}, (_, i) => firstYear + i);

  // Focus the day on open (autoFocus) and after keyboard moves.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${focus}"]`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${focus}"]`)?.focus();
  }, [focus]);

  const goMonth = (y: number, m: number) => {
    const days = new Date(y, m + 1, 0).getDate();
    setFocus(toIso(new Date(y, m, Math.min(view.getDate(), days))));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const step: Record<string, number> = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7};
    let next: string | null = null;
    if (e.key in step) next = addDays(focus, step[e.key]!);
    else if (e.key === 'Home') next = addDays(focus, -((view.getDay() + 6) % 7));
    else if (e.key === 'End') next = addDays(focus, 6 - ((view.getDay() + 6) % 7));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const d = new Date(year, month + (e.key === 'PageUp' ? -1 : 1), 1);
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      next = toIso(new Date(d.getFullYear(), d.getMonth(), Math.min(view.getDate(), days)));
    }
    if (next === null) return;
    e.preventDefault();
    moved.current = true;
    setFocus(next);
  };

  return (
    <div className="ft-calendar">
      <div className="ft-calendar-head">
        <button type="button" className="ft-calendar-nav" aria-label="Previous month" onClick={() => goMonth(year, month - 1)}>
          <FtIcon name="chevron-left" />
        </button>
        <span className="ft-calendar-caption">
          <select aria-label="Month" value={month} onChange={e => goMonth(year, Number(e.target.value))} className="ft-calendar-select">
            {monthNames.map((n, m) => (
              <option key={n} value={m}>
                {n}
              </option>
            ))}
          </select>
          <select aria-label="Year" value={year} onChange={e => goMonth(Number(e.target.value), month)} className="ft-calendar-select">
            {(years.includes(year) ? years : [...years, year].sort((a, b) => a - b)).map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </span>
        <button type="button" className="ft-calendar-nav" aria-label="Next month" onClick={() => goMonth(year, month + 1)}>
          <FtIcon name="chevron-right" />
        </button>
      </div>
      <table ref={grid} role="grid" aria-label={`${monthNames[month]} ${year}`} className="ft-calendar-grid" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdays.map(w => (
              <th key={w.long} scope="col" abbr={w.long}>
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => (
            <tr key={week.find(Boolean) ?? 'x'}>
              {week.map((iso, i) =>
                iso ? (
                  <td key={iso}>
                    <button
                      type="button"
                      data-day={iso}
                      tabIndex={iso === focus ? 0 : -1}
                      aria-pressed={iso === selected}
                      aria-current={iso === today ? 'date' : undefined}
                      aria-label={dayName.format(fromIso(iso))}
                      disabled={!isDayAllowed(iso, limits, today)}
                      onClick={() => onSelect(iso)}
                      onFocus={() => iso !== focus && setFocus(iso)}
                      className={cx('ft-calendar-day', iso === today && 'ft-calendar-today')}>
                      {fromIso(iso).getDate()}
                    </button>
                  </td>
                ) : (
                  <td key={`e${i}`} />
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
