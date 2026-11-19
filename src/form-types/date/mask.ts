import {isIsoDate, type DateFormat} from '../../lib/intelform/form/types/formats';

/** Date text helpers for the date field (pure; unit tested). */

/** Order and separator of each display format. */
const SHAPES: Record<DateFormat, {order: ('d' | 'm' | 'y')[]; sep: string}> = {
  'DD/MM/YYYY': {order: ['d', 'm', 'y'], sep: '/'},
  'MM/DD/YYYY': {order: ['m', 'd', 'y'], sep: '/'},
  'YYYY-MM-DD': {order: ['y', 'm', 'd'], sep: '-'},
  'DD.MM.YYYY': {order: ['d', 'm', 'y'], sep: '.'},
};

/** Typed text masked to the format: digits only, separators inserted, at most 8 digits. */
export function maskDate(raw: string, format: DateFormat): string {
  const {order, sep} = SHAPES[format];
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = '';
  let pos = 0;
  for (const [i, k] of order.entries()) {
    const len = k === 'y' ? 4 : 2;
    const part = digits.slice(pos, pos + len);
    if (!part) break;
    out += (i ? sep : '') + part;
    pos += len;
  }
  return out;
}

/** Masked text as "YYYY-MM-DD", or null while incomplete or not a real date. */
export function dateTextToIso(text: string, format: DateFormat): string | null {
  const {order} = SHAPES[format];
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const parts: Record<string, string> = {};
  let pos = 0;
  for (const k of order) {
    const len = k === 'y' ? 4 : 2;
    parts[k] = digits.slice(pos, pos + len);
    pos += len;
  }
  const iso = `${parts.y}-${parts.m}-${parts.d}`;
  return isIsoDate(iso) ? iso : null;
}

export const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Whether a day can be picked in the calendar, given the field's limits ("YYYY-MM-DD" compare). */
export function isDayAllowed(
  iso: string,
  limits: {minDate: string | null; maxDate: string | null; disablePast: boolean; disableFuture: boolean},
  today: string
): boolean {
  if (limits.minDate && iso < limits.minDate) return false;
  if (limits.maxDate && iso > limits.maxDate) return false;
  if (limits.disablePast && iso < today) return false;
  if (limits.disableFuture && iso > today) return false;
  return true;
}

/**
 * The weeks of a month for a calendar grid, Monday first: 7-day rows of ISO dates, with null
 * for the days outside the month.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({length: lead}, () => null);
  for (let d = 1; d <= days; d++) cells.push(toIso(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** An ISO date moved by a number of days. */
export function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}
