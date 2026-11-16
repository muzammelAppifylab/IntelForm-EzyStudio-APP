import {infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import {
  CONTACT_HAS,
  type ContactDetailResponse,
  type ContactHas,
  type ContactSegment,
  type ContactSort,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '../../../lib/intelform/api-contacts';
import {toQueryString} from '../../../lib/intelform/api-responses';
import {api} from '../lib/api';

/**
 * Contacts data for the dashboard (`/site-api/contacts`). Mutations invalidate by prefix
 * `['intelform', 'contacts']`; erasing contacts also refreshes forms (response counts) and responses.
 */

export const contactsKey = ['intelform', 'contacts'] as const;

export const CONTACTS_PATH = '/site-api/contacts';
export const CONTACTS_CSV_PATH = `${CONTACTS_PATH}/export.csv`;

export const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/** What defines the list: search, segment, the advanced filters and the sort. */
export interface ContactsState {
  q: string;
  segment: ContactSegment;
  form: string[];
  country: string[];
  has: ContactHas[];
  from?: string;
  to?: string;
  min?: number;
  max?: number;
  sort: ContactSort;
  dir: 'asc' | 'desc';
}

/** The filters in the Filters panel (apart from search and segment). */
export type AdvancedFilters = Pick<ContactsState, 'form' | 'country' | 'has' | 'from' | 'to' | 'min' | 'max'>;

/** Name and email read A to Z by default; dates and counts newest / most first. */
export const defaultDir = (sort: ContactSort): 'asc' | 'desc' => (sort === 'name' || sort === 'email' ? 'asc' : 'desc');

export const DEFAULT_CONTACTS_STATE: ContactsState = {
  q: '',
  segment: 'all',
  form: [],
  country: [],
  has: [],
  sort: 'last_seen',
  dir: 'desc',
};

export const NO_ADVANCED: AdvancedFilters = {form: [], country: [], has: []};

/** Removes every filter (search, segment, advanced); keeps the sort. */
export const clearFilters = (s: ContactsState): ContactsState => ({...DEFAULT_CONTACTS_STATE, sort: s.sort, dir: s.dir});

export function advancedCount(s: AdvancedFilters): number {
  return [s.form.length > 0, s.country.length > 0, s.has.length > 0, !!(s.from || s.to), s.min !== undefined || s.max !== undefined].filter(
    Boolean
  ).length;
}

export function isFiltered(s: ContactsState): boolean {
  return s.q !== '' || s.segment !== 'all' || advancedCount(s) > 0;
}

/** The query-string params for the list and CSV (arrays repeat; empty values drop). */
export function filterParams(s: ContactsState, tz = browserTz) {
  return {
    q: s.q || undefined,
    segment: s.segment === 'all' ? undefined : s.segment,
    form: s.form,
    country: s.country,
    has: CONTACT_HAS.filter(h => s.has.includes(h)),
    from: s.from,
    to: s.to,
    tz,
    min: s.min,
    max: s.max,
    sort: s.sort,
    dir: s.dir,
  };
}

/** The list, 50 a page; "Load more" asks for the next page while the total says there is one. */
export const contactsListQuery = (s: ContactsState) =>
  infiniteQueryOptions({
    queryKey: [...contactsKey, 'list', s],
    queryFn: ({pageParam, signal}) =>
      api<ContactsListResponse>(`${CONTACTS_PATH}${toQueryString({...filterParams(s), page: pageParam > 1 ? pageParam : undefined})}`, {signal}),
    initialPageParam: 1,
    getNextPageParam: last => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });

/** Strip and filter choices: workspace-wide, so one fetch serves every filter. */
export const contactsOverviewQuery = queryOptions({
  queryKey: [...contactsKey, 'overview'],
  queryFn: ({signal}) => api<ContactsOverviewResponse>(`${CONTACTS_PATH}/overview`, {signal}),
  staleTime: 60_000,
});

export const contactDetailQuery = (key: string) =>
  queryOptions({
    queryKey: [...contactsKey, 'detail', key],
    queryFn: ({signal}) => api<ContactDetailResponse>(`${CONTACTS_PATH}/detail${toQueryString({key})}`, {signal}),
  });

/** CSV of the current filters, or of just these contacts (in the list's order). */
export function contactsCsvUrl(s: ContactsState, keys: string[] = [], tz = browserTz): string {
  const qs = keys.length ? toQueryString({key: keys.slice(0, 1000), tz, sort: s.sort, dir: s.dir}) : toQueryString(filterParams(s, tz));
  return `${CONTACTS_CSV_PATH}${qs}`;
}

/** Erase contacts (every response they sent). Refreshes contacts, forms and responses. */
export function useDeleteContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[]) => api<DeleteContactsResponse>(`${CONTACTS_PATH}/delete`, {method: 'POST', body: {keys}}),
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: contactsKey});
      void qc.invalidateQueries({queryKey: ['intelform', 'forms']});
      void qc.invalidateQueries({queryKey: ['intelform', 'responses']});
      void qc.invalidateQueries({queryKey: ['intelform', 'overview']});
    },
  });
}
