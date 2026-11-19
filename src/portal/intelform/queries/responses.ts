import {keepPreviousData, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {
  BulkDeleteResponse,
  CatalogField,
  ResponseDetail,
  ResponsesListResponse,
  SummaryResponse,
  TableColumnPref,
  TablePrefsResponse,
} from '../../../lib/intelform/api-responses';
import {MAX_TABLE_COLUMNS, RESPONSES_PAGE_SIZE, RESPONSES_PAGE_SIZES, searchTerm} from '../../../lib/intelform/api-responses';
import {api} from '../lib/api';
import {formResponsesPath, summaryQueryString, tableQueryString, type SummaryState, type TableState} from '../responses/state';

/**
 * The Responses tab's data (`/site-api/responses/forms/:id/...`, src/server/routes/responses.ts).
 * Keys start `['intelform', 'responses', formId]`; deleting invalidates them (except the column
 * prefs) and marks the forms list and contacts stale (their response counts changed).
 */

export const responsesRootKey = ['intelform', 'responses'] as const;
export const responsesKey = (formId: string) => [...responsesRootKey, formId] as const;

/** A table page: the shared shape (keyset cursors for the pages either side). */
export type ResponsesPage = ResponsesListResponse;

/**
 * Where a table page starts. Page 1 has no cursor; next pages are `cursor` (after the page
 * before), previous ones `before` (before the page after), the last page `last` rows from the
 * end. `page` is the number the pager shows: the server never skips rows by offset.
 */
export interface PageNav {
  page: number;
  cursor?: string;
  before?: string;
  last?: number;
}

export const FIRST_PAGE: PageNav = {page: 1};

/**
 * Responses data is read when the tab opens and after a change made here (a delete); never
 * again just because the browser tab regained focus (on a big form that is a page of up to
 * 100 wide rows, or a summary of every question, for nothing). Fresh for 2 minutes.
 */
const RESPONSES_STALE_MS = 120_000;
/**
 * Table pages are keyed by cursor and rarely opened twice: dropped a minute after they leave
 * the screen, so walking many pages keeps memory bounded (the shape of `maxPages`).
 */
const PAGE_GC_MS = 60_000;

/**
 * The table's rows for one page: `size` rows from `nav`, within the filters and sort. `cols`:
 * the visible column ids (at most MAX_TABLE_COLUMNS), so a wide form sends only those cells.
 * A page from either end (no cursor) also carries `fields`, the catalog the table keeps.
 */
export function responsesListQuery(formId: string, t: TableState, size: number, cols: readonly string[], nav: PageNav, enabled = true) {
  const col = cols.slice(0, MAX_TABLE_COLUMNS);
  return queryOptions({
    queryKey: [...responsesKey(formId), 'list', tableKey(t), size, col, nav] as const,
    queryFn: async ({signal, client}): Promise<ResponsesPage> => {
      const page = await api<ResponsesPage>(
        `${formResponsesPath(formId)}/responses${tableQueryString(t, {
          cursor: nav.cursor,
          before: nav.cursor ? undefined : nav.before,
          last: nav.cursor || nav.before ? undefined : nav.last,
          page: nav.page > 1 ? nav.page : undefined,
          size: size === RESPONSES_PAGE_SIZE ? undefined : size,
          col,
        })}`,
        {signal}
      );
      // A page from either end carries the catalog: the table's columns follow it.
      if (page.fields) client.setQueryData<CatalogField[]>(responseFieldsKey(formId), page.fields);
      return page;
    },
    placeholderData: keepPreviousData,
    staleTime: RESPONSES_STALE_MS,
    gcTime: PAGE_GC_MS,
    refetchOnWindowFocus: false,
    enabled,
  });
}

/**
 * The answer columns (the catalog) the table and its menus are built from, before any page:
 * the visible columns decide which cells a page asks for. One small read (the smallest page,
 * no answer cells); afterwards every page read from either end refreshes it.
 */
const responseFieldsKey = (formId: string) => [...responsesKey(formId), 'fields'] as const;

export function responseFieldsQuery(formId: string) {
  return queryOptions({
    queryKey: responseFieldsKey(formId),
    queryFn: ({signal}) =>
      api<ResponsesPage>(
        `${formResponsesPath(formId)}/responses${tableQueryString(
          {q: '', filter: [], sort: 'submitted_at', dir: 'desc'},
          {size: RESPONSES_PAGE_SIZES[0], col: ['submitted_at']}
        )}`,
        {signal}
      ).then((page): CatalogField[] => page.fields ?? []),
    staleTime: RESPONSES_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

/** The table state as a query key: a search too short to run is no search (same request, same key). */
const tableKey = (t: TableState): TableState => ({...t, q: searchTerm(t.q)});

/** Every cached table page for these filters (any page, any size): the drawer's "3 of 120". */
export const responsesListPrefix = (formId: string, t: TableState) => [...responsesKey(formId), 'list', tableKey(t)] as const;

/** One response for the drawer, with prev / next inside the table's filters and sort. */
export function responseDetailQuery(formId: string, responseId: string, t: TableState) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'detail', responseId, tableKey(t)] as const,
    queryFn: ({signal}) =>
      api<ResponseDetail>(`${formResponsesPath(formId)}/responses/${encodeURIComponent(responseId)}${tableQueryString(t)}`, {signal}),
    placeholderData: keepPreviousData,
    enabled: !!responseId,
    staleTime: RESPONSES_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function responsesSummaryQuery(formId: string, s: SummaryState) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'summary', s] as const,
    queryFn: ({signal}) => api<SummaryResponse>(`${formResponsesPath(formId)}/summary${summaryQueryString(s)}`, {signal}),
    placeholderData: keepPreviousData,
    staleTime: RESPONSES_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function responsePrefsQuery(formId: string) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'prefs'] as const,
    queryFn: ({signal}) => api<TablePrefsResponse>(`${formResponsesPath(formId)}/responses/prefs`, {signal}),
    staleTime: Infinity,
  });
}

/** Saves the column order / visibility; the table follows at once (optimistic). */
export function useSaveResponsePrefs(formId: string, onError?: (err: unknown) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (columns: TableColumnPref[]) =>
      api<TablePrefsResponse>(`${formResponsesPath(formId)}/responses/prefs`, {method: 'PUT', body: {columns}}),
    onMutate: columns => {
      qc.setQueryData(responsePrefsQuery(formId).queryKey, {columns});
    },
    onError,
  });
}

/** Deletes one response (DELETE) or several (bulk-delete). */
export function useDeleteResponses(formId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1
        ? api<BulkDeleteResponse>(`${formResponsesPath(formId)}/responses/${encodeURIComponent(ids[0]!)}`, {method: 'DELETE'})
        : api<BulkDeleteResponse>(`${formResponsesPath(formId)}/responses/bulk-delete`, {method: 'POST', body: {ids}}),
    onSuccess: (_result, ids) => {
      const key = responsesKey(formId);
      // Drop the deleted ones first so an open drawer doesn't refetch a 404.
      for (const id of ids) qc.removeQueries({queryKey: [...key, 'detail', id]});
      // Table pages off screen hold cursors and counts from before the delete: drop them, and
      // refetch only the page on screen.
      qc.removeQueries({queryKey: [...key, 'list'], type: 'inactive'});
      void qc.invalidateQueries({queryKey: [...key, 'list']});
      // The summary counted them: refetched if shown, else when next opened.
      void qc.invalidateQueries({queryKey: [...key, 'summary']});
      // Other responses' answers did not change, only (maybe) their prev / next: the open
      // drawer refetches, the rest are read again when opened. Column prefs did not change.
      void qc.invalidateQueries({queryKey: [...key, 'detail']});
      // Response counts on the forms list, the overview and contacts: refresh when next shown.
      void qc.invalidateQueries({queryKey: ['intelform', 'forms'], refetchType: 'none'});
      void qc.invalidateQueries({queryKey: ['intelform', 'contacts'], refetchType: 'none'});
      void qc.invalidateQueries({queryKey: ['intelform', 'overview'], refetchType: 'none'});
    },
  });
}
