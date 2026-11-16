import {describe, expect, it} from 'vitest';

import type {ContactsListResponse} from '../../src/lib/intelform/api-contacts';
import {checkFilters} from '../../src/portal/intelform/contacts/Filters';
import {
  contactSubtitle,
  contactTitle,
  countRangeLabel,
  dateRangeLabel,
  formatDuration,
  formatPhone,
  plural,
} from '../../src/portal/intelform/contacts/format';
import {parseHidden} from '../../src/portal/intelform/contacts/prefs';
import {
  advancedCount,
  clearFilters,
  contactsCsvUrl,
  contactsListQuery,
  DEFAULT_CONTACTS_STATE,
  defaultDir,
  filterParams,
  isFiltered,
  NO_ADVANCED,
} from '../../src/portal/intelform/queries/contacts';

const FORM = '00000000-0000-4000-8000-00000000f001';

describe('contacts display helpers', () => {
  it('titles a contact by name, else email, else phone', () => {
    expect(contactTitle({name: 'Ada', email: 'ada@example.com', phone: null})).toBe('Ada');
    expect(contactTitle({name: null, email: 'ada@example.com', phone: '+15555550123'})).toBe('ada@example.com');
    expect(contactTitle({name: null, email: null, phone: '+14155550123'})).toBe('+1 415 555 0123');
    expect(contactTitle({name: null, email: null, phone: null})).toBe('Unknown contact');
  });

  it('puts the next detail under the title', () => {
    expect(contactSubtitle({name: 'Ada', email: 'ada@example.com', phone: null})).toBe('ada@example.com');
    expect(contactSubtitle({name: null, email: 'ada@example.com', phone: '+14155550123'})).toBe('+1 415 555 0123');
    expect(contactSubtitle({name: null, email: null, phone: '+14155550123'})).toBeNull();
  });

  it('formats phones, durations and counts', () => {
    expect(formatPhone('not a phone')).toBe('not a phone');
    expect(formatDuration(4_000)).toBe('4s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(null)).toBe('–');
    expect(plural(1, 'contact')).toBe('1 contact');
    expect(plural(1200, 'contact')).toBe('1,200 contacts');
  });

  it('labels the range chips', () => {
    expect(countRangeLabel(2, 2)).toBe('2 responses');
    expect(countRangeLabel(1, 1)).toBe('1 response');
    expect(countRangeLabel(2, 5)).toBe('2–5 responses');
    expect(countRangeLabel(3, undefined)).toBe('At least 3 responses');
    expect(countRangeLabel(undefined, 1)).toBe('At most 1 response');
    expect(countRangeLabel(undefined, undefined)).toBeNull();
    expect(dateRangeLabel('2026-10-03', undefined)).toBe('since 3 Oct');
    expect(dateRangeLabel(undefined, undefined)).toBeNull();
  });
});

describe('contacts list state', () => {
  it('counts the advanced filters and knows when anything filters', () => {
    expect(advancedCount(NO_ADVANCED)).toBe(0);
    expect(advancedCount({...NO_ADVANCED, form: [FORM], from: '2026-01-01', min: 2, max: 3})).toBe(3);
    expect(isFiltered(DEFAULT_CONTACTS_STATE)).toBe(false);
    expect(isFiltered({...DEFAULT_CONTACTS_STATE, segment: 'returning'})).toBe(true);
    expect(isFiltered({...DEFAULT_CONTACTS_STATE, q: 'ada'})).toBe(true);
  });

  it('clears filters but keeps the sort', () => {
    const s = {...DEFAULT_CONTACTS_STATE, q: 'x', country: ['GB'], sort: 'name' as const, dir: 'asc' as const};
    expect(clearFilters(s)).toEqual({...DEFAULT_CONTACTS_STATE, sort: 'name', dir: 'asc'});
    expect(defaultDir('email')).toBe('asc');
    expect(defaultDir('responses')).toBe('desc');
  });

  it('builds the query string the server reads', () => {
    const p = filterParams({...DEFAULT_CONTACTS_STATE, has: ['phone', 'email'], segment: 'all'}, 'Europe/London');
    expect(p).toMatchObject({segment: undefined, has: ['email', 'phone'], tz: 'Europe/London', sort: 'last_seen', dir: 'desc'});
  });

  it('links the CSV to the filters, or to the picked contacts only', () => {
    const s = {...DEFAULT_CONTACTS_STATE, form: [FORM], q: 'ada'};
    expect(contactsCsvUrl(s, [], 'UTC')).toBe(`/site-api/contacts/export.csv?q=ada&form=${FORM}&tz=UTC&sort=last_seen&dir=desc`);
    expect(contactsCsvUrl(s, ['e:ada@example.com', 'p:+15555550123'], 'UTC')).toBe(
      '/site-api/contacts/export.csv?key=e%3Aada%40example.com&key=p%3A%2B15555550123&tz=UTC&sort=last_seen&dir=desc'
    );
  });

  it('asks for the next page while the total says there is one', () => {
    const q = contactsListQuery(DEFAULT_CONTACTS_STATE);
    const page = (p: number, total: number): ContactsListResponse => ({contacts: [], total, page: p, pageSize: 50});
    const next = q.getNextPageParam!;
    expect(next(page(1, 120), [], 1, [])).toBe(2);
    expect(next(page(3, 120), [], 3, [])).toBeUndefined();
    expect(next(page(1, 50), [], 1, [])).toBeUndefined();
    expect(q.queryKey).toEqual(['intelform', 'contacts', 'list', DEFAULT_CONTACTS_STATE]);
  });
});

describe('contacts filters panel', () => {
  it('accepts a valid draft', () => {
    const {value, errors} = checkFilters({...NO_ADVANCED, form: [FORM], from: '2026-01-01', to: '2026-01-31'}, '2', '');
    expect(errors).toEqual({});
    expect(value).toMatchObject({form: [FORM], from: '2026-01-01', to: '2026-01-31', min: 2, max: undefined});
  });

  it('explains bad ranges in place', () => {
    const inverted = checkFilters({...NO_ADVANCED, from: '2026-02-01', to: '2026-01-01'}, '5', '2');
    expect(inverted.value).toBeNull();
    expect(inverted.errors.from).toMatch(/before/);
    expect(inverted.errors.min).toMatch(/at most/);
    const zero = checkFilters(NO_ADVANCED, '0', '');
    expect(zero.errors.min).toBe('Use a whole number of 1 or more');
  });
});

describe('contacts column preferences', () => {
  it('keeps only known columns from storage', () => {
    expect(parseHidden(null)).toEqual([]);
    expect(parseHidden('["phone","nope","lastSeen"]')).toEqual(['phone', 'lastSeen']);
    expect(parseHidden('{bad json')).toEqual([]);
    expect(parseHidden('{"a":1}')).toEqual([]);
  });
});
