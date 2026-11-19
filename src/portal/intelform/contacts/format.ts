import {parsePhoneNumberFromString} from 'libphonenumber-js/min';

import type {ContactRow} from '../../../lib/intelform/api-contacts';
import {countryName} from '../../../lib/intelform/form/types/countries';

/** Display helpers for the Contacts screen (ported from legacy contacts/format.ts). */

const numberFmt = new Intl.NumberFormat('en-GB');
const dateOnly = new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium'});
const dayShort = new Intl.DateTimeFormat('en-GB', {month: 'short', day: 'numeric'});

export const formatNumber = (n: number) => numberFmt.format(n);
export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** The detail counts each form's responses up to this many (server: FORM_COUNT_CAP in contacts/query.ts). */
export const FORM_COUNT_CAP = 1000;

/** "12 responses", or "1,000+ responses" past the cap. */
export const formResponses = (n: number) => (n > FORM_COUNT_CAP ? `${formatNumber(FORM_COUNT_CAP)}+ responses` : plural(n, 'response'));

export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** "19 Oct" for a YYYY-MM-DD local day (no time-zone shift). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayShort.format(new Date(y!, m! - 1, d!));
}

export const countryLabel = (code: string | null) => (code ? countryName(code) : '–');

/** +14155550123 → "+1 415 555 0123". */
export function formatPhone(phone: string): string {
  try {
    return parsePhoneNumberFromString(phone)?.formatInternational() ?? phone;
  } catch {
    return phone;
  }
}

type Who = Pick<ContactRow, 'name' | 'email' | 'phone'>;

/** The name, else the email, else the phone. */
export function contactTitle(c: Who): string {
  return c.name || c.email || (c.phone ? formatPhone(c.phone) : 'Unknown contact');
}

/** The line under the title: the email when the title is the name, else the phone. */
export function contactSubtitle(c: Who): string | null {
  if (c.name) return c.email ?? (c.phone ? formatPhone(c.phone) : null);
  if (c.email) return c.phone ? formatPhone(c.phone) : null;
  return null;
}

/** 95_000 → "1m 35s"; 4_000 → "4s". */
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

export const deviceLabel = (d: string | null) => (d ? d.charAt(0).toUpperCase() + d.slice(1) : null);

/** "Last active 3 Oct – 9 Oct", "since 3 Oct", "until 9 Oct". */
export function dateRangeLabel(from: string | undefined, to: string | undefined): string | null {
  if (from && to) return `${formatDay(from)} – ${formatDay(to)}`;
  if (from) return `since ${formatDay(from)}`;
  if (to) return `until ${formatDay(to)}`;
  return null;
}

/** "2–5 responses", "At least 3 responses", "1 response". */
export function countRangeLabel(min: number | undefined, max: number | undefined): string | null {
  const word = (n: number) => (n === 1 ? 'response' : 'responses');
  if (min !== undefined && max !== undefined) {
    return min === max ? `${formatNumber(min)} ${word(min)}` : `${formatNumber(min)}–${formatNumber(max)} responses`;
  }
  if (min !== undefined) return `At least ${formatNumber(min)} ${word(min)}`;
  if (max !== undefined) return `At most ${formatNumber(max)} ${word(max)}`;
  return null;
}
