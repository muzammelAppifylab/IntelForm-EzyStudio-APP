import {countryName} from '../../../lib/intelform/form/types/countries';

/** Display helpers for the Responses tab (legacy src/pages/builder/responses/format.ts). */

const dateTime = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'});
const dateOnly = new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'});
const numberFmt = new Intl.NumberFormat();

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatNumber = (n: number) => numberFmt.format(n);

/** "Oct 19" for a YYYY-MM-DD local day (no time-zone shift). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return dateOnly.format(new Date(y!, m! - 1, d!));
}

/** "Oct 19" for a timestamp, in the viewer's zone. */
export const formatShortDate = (iso: string) => dateOnly.format(new Date(iso));

/** 95_000 → "1m 35s"; 4_000 → "4s"; 3_900_000 → "1h 5m"; 3 days → "3d". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.round(h / 24)}d`;
}

export function formatPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '–';
  return `${n.toFixed(digits)}%`;
}

/** One decimal only when the share is not whole ("33.3%", "50%"). */
export const formatShare = (n: number) => formatPct(n, n % 1 ? 1 : 0);

export function deviceLabel(d: string | null): string {
  if (!d) return '–';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export function countryLabel(code: string | null): string {
  return code ? countryName(code) : '–';
}

export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;
