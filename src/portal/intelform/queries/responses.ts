import {infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {
  BulkDeleteResponse,
  ResponseDetail,
  ResponsesListResponse,
  SummaryResponse,
  TableColumnPref,
  TablePrefsResponse,
} from '../../../lib/intelform/api-responses';
import {api} from '../lib/api';
import {formResponsesPath, summaryQueryString, tableQueryString, type SummaryState, type TableState} from '../responses/state';

/**
 * The Responses tab's data (`/site-api/responses/forms/:id/...`, src/server/routes/responses.ts).
 * Keys start `['intelform', 'responses', formId]`; deleting invalidates them (except the column
 * prefs) and marks the forms list and contacts stale (their response counts changed).
 */

export const responsesRootKey = ['intelform', 'responses'] as const;
export const responsesKey = (formId: string) => [...responsesRootKey, formId] as const;

/** A table page: the shared shape plus the keyset cursor for the next one (null on the last). */
export interface ResponsesPage extends ResponsesListResponse {
  nextCursor: string | null;
}

type PageParam = {cursor: string | null; page: number};

/** The table, keyset-paged: "Load more" fetches the rows after the last one. */
export function responsesListQuery(formId: string, t: TableState) {
  return infiniteQueryOptions({
    queryKey: [...responsesKey(formId), 'list', t] as const,
    initialPageParam: {cursor: null, page: 1} as PageParam,
    queryFn: ({pageParam, signal}) =>
      api<ResponsesPage>(
        `${formResponsesPath(formId)}/responses${tableQueryString(t, {
          cursor: pageParam.cursor ?? undefined,
          page: pageParam.page > 1 ? pageParam.page : undefined,
        })}`,
        {signal}
      ),
    getNextPageParam: (last, pages): PageParam | undefined =>
      last.nextCursor ? {cursor: last.nextCursor, page: pages.length + 1} : undefined,
    placeholderData: keepPreviousData,
  });
}

/** One response for the drawer, with prev / next inside the table's filters and sort. */
export function responseDetailQuery(formId: string, responseId: string, t: TableState) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'detail', responseId, t] as const,
    queryFn: ({signal}) =>
      api<ResponseDetail>(`${formResponsesPath(formId)}/responses/${encodeURIComponent(responseId)}${tableQueryString(t)}`, {signal}),
    placeholderData: keepPreviousData,
    enabled: !!responseId,
  });
}

export function responsesSummaryQuery(formId: string, s: SummaryState) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'summary', s] as const,
    queryFn: ({signal}) => api<SummaryResponse>(`${formResponsesPath(formId)}/summary${summaryQueryString(s)}`, {signal}),
    placeholderData: keepPreviousData,
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
      // Drop the deleted ones first so an open drawer doesn't refetch a 404.
      for (const id of ids) qc.removeQueries({queryKey: [...responsesKey(formId), 'detail', id]});
      // List, summary and the neighbours' prev / next changed; column prefs did not.
      void qc.invalidateQueries({queryKey: responsesKey(formId), predicate: q => q.queryKey[3] !== 'prefs'});
      // Response counts on the forms list, the overview and contacts: refresh when next shown.
      void qc.invalidateQueries({queryKey: ['intelform', 'forms'], refetchType: 'none'});
      void qc.invalidateQueries({queryKey: ['intelform', 'contacts'], refetchType: 'none'});
      void qc.invalidateQueries({queryKey: ['intelform', 'overview'], refetchType: 'none'});
    },
  });
}
