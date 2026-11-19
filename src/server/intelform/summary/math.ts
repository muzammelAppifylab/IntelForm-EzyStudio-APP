import type {FieldType} from '../../../lib/intelform/form/field-types';
import {isTimeZone} from '../../../lib/intelform/settings-app';
import type {FormCatalog} from '../responses/catalog';

/**
 * The pure parts of the Summary rollup (no database): which fields are summed how, how a range
 * of local days splits into whole months and loose days, and medians from bucket counts. The
 * SQL side is prisma/migrations/20261119140200_summary_days (form_summary_contrib and friends).
 */

/** Counted per option (or per value: Yes / No, country, score). */
export const COUNTED = new Set<FieldType>(['single_choice', 'dropdown', 'multiple_choice', 'picture_choice', 'yes_no', 'country', 'rating', 'nps']);
/** Summed as numbers (averages). */
export const NUMERIC = new Set<FieldType>(['number', 'rating', 'nps']);
/** Kept by value too (median, min, max). */
export const EXACT = new Set<FieldType>(['number']);

/** Bucket ratios: the SQL's form_summary_bucket(v, r) for durations ('d') and time per question ('t'). */
export const DURATION_RATIO = 1.1;
export const TTC_RATIO = 1.2;

export interface FieldClasses {
  counted: string[];
  numeric: string[];
  exact: string[];
}

/** The field classes of a form, from its catalog (every version's fields). Sorted, so equal sets compare equal. */
export function fieldClasses(cat: FormCatalog): FieldClasses {
  const ids = (set: Set<FieldType>) =>
    cat.entries
      .filter(e => set.has(e.meta.type))
      .map(e => e.meta.id)
      .sort();
  return {counted: ids(COUNTED), numeric: ids(NUMERIC), exact: ids(EXACT)};
}

/**
 * The zone Summary days are in: the app's (Settings → General), if it is a named zone both Intl
 * and Postgres know; UTC otherwise. Not `safeTz`: the runtime's list of zones holds only
 * canonical names (Asia/Calcutta, not the Asia/Kolkata the settings allow).
 */
export function summaryZone(tz: string | null | undefined): string {
  return tz && tz.length <= 64 && /^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz) && isTimeZone(tz) ? tz : 'UTC';
}

// ------------------------------------------------------------------ Days and months

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y!, m!, d!];
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The first day of the month after `day`'s month. */
export function nextMonth(day: string): string {
  const [y, m] = parts(day);
  return iso(Date.UTC(y, m, 1));
}

/** The first day of `day`'s month. */
export function monthStart(day: string): string {
  const [y, m] = parts(day);
  return iso(Date.UTC(y, m - 1, 1));
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return iso(Date.UTC(y, m - 1, d + n));
}

export type DayRange = [from: string, to: string];

export interface RangePlan {
  /** Month rows to read, first days, inclusive; null for none. */
  months: DayRange | null;
  /** Day rows to read (at most two runs: before and after the months). */
  days: DayRange[];
}

/**
 * Which rows answer local days [from, to]. A month row is used when the range holds every day
 * of that month that can have responses: all of it, or, when the range runs to today (or
 * later), up to today (nothing is submitted in the future). With `open` (All time) nothing
 * comes before `from`, so the first month counts whole too. Everything else is read by day.
 */
export function planRange(from: string, to: string, today: string, open = false): RangePlan {
  const dataTo = to >= today ? '9999-12-31' : to;
  const first = open || from === monthStart(from) ? monthStart(from) : nextMonth(from);
  // The last month whose last day is inside [.., dataTo]; past `to` only when nothing can be there.
  let last: string | null = null;
  const lastCandidate = monthStart(to);
  if (addDays(nextMonth(lastCandidate), -1) <= dataTo) last = lastCandidate;
  else if (lastCandidate > first) last = monthStart(addDays(lastCandidate, -1));
  if (!last || last < first) return {months: null, days: [[from, to]]};
  const days: DayRange[] = [];
  if (from < first) days.push([from, addDays(first, -1)]);
  const after = nextMonth(last);
  if (after <= to) days.push([after, to]);
  return {months: [first, last], days};
}

// ------------------------------------------------------------------ Medians

/**
 * The median (percentile_cont(0.5)) of a multiset given as value → count: the middle value, or
 * the mean of the two middle values. Null when empty.
 */
export function medianOf(counts: Iterable<[number, number]>): number | null {
  const list = [...counts].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  const total = list.reduce((s, [, n]) => s + n, 0);
  if (total <= 0) return null;
  const at = (rank: number) => {
    let seen = 0;
    for (const [v, n] of list) {
      seen += n;
      if (rank < seen) return v;
    }
    return list[list.length - 1]![0];
  };
  return total % 2 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2;
}

/** A log bucket back as a value: the geometric middle of [r^b, r^(b+1)); bucket -1 (under 1 ms) is 0. */
export function bucketValue(bucket: number, ratio: number): number {
  return bucket < 0 ? 0 : Math.pow(ratio, bucket + 0.5);
}

/** The approximate median of log-bucket counts (bucket → count). */
export function bucketMedian(buckets: Map<string, number>, ratio: number): number | null {
  return medianOf([...buckets].map(([b, n]) => [bucketValue(Number(b), ratio), n] as [number, number]));
}
