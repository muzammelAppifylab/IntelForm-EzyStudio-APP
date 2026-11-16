import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import {
  SUMMARY_RANGES,
  toQueryString,
  type BulkDeleteResponse,
  type ResponseDetail,
  type ResponsesListResponse,
  type SummaryRange,
  type SummaryResponse,
  type TableColumnPref,
  type TablePrefsResponse,
} from '@shared/api-responses'
import { api, ApiRequestError, errorMessage } from '@/lib/api'
import type { ApiErrorBody } from '@shared/api'

/** Data and URL state for the Responses tab. Everything that defines a view lives in the URL. */

export const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

export const responsesKey = (formId: string) => ['responses', formId] as const

/** Table filters as read from the URL (`t`-prefixed dates keep them apart from the summary range). */
export interface TableState {
  q: string
  from?: string
  to?: string
  filter: string[]
  has?: string
  sort: string
  dir: 'asc' | 'desc'
  page: number
}

export interface SummaryState {
  range: SummaryRange
  from?: string
  to?: string
}

export function useResponsesUrl() {
  const [params, setParams] = useSearchParams()
  const table = useMemo<TableState>(
    () => ({
      q: params.get('q') ?? '',
      from: params.get('tfrom') ?? undefined,
      to: params.get('tto') ?? undefined,
      filter: params.getAll('filter'),
      has: params.get('has') ?? undefined,
      sort: params.get('sort') ?? 'submitted_at',
      dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
      page: Math.max(1, Number(params.get('page')) || 1),
    }),
    [params],
  )
  const rangeParam = params.get('range') as SummaryRange | null
  const summary = useMemo<SummaryState>(
    () => ({
      range: rangeParam && SUMMARY_RANGES.includes(rangeParam) ? rangeParam : '30d',
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    }),
    [params, rangeParam],
  )
  const view: 'summary' | 'table' = params.get('view') === 'table' ? 'table' : 'summary'
  const responseId = params.get('response')

  /** Patch the URL: null/undefined/'' removes a key, arrays become repeated keys. */
  const update = useCallback(
    (patch: Record<string, string | number | string[] | null | undefined>, opts: { replace?: boolean } = {}) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          next.delete(k)
          if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
          else if (v !== null && v !== undefined && v !== '') next.set(k, String(v))
        }
        return next
      },
      { replace: opts.replace ?? false },
    ),
    [setParams],
  )

  return { view, table, summary, responseId, update }
}

/** Query string for the API's filter schema. */
export function tableQueryString(t: TableState, extra: Record<string, string | number | string[] | undefined> = {}) {
  return toQueryString({
    q: t.q || undefined,
    from: t.from,
    to: t.to,
    tz: browserTz,
    filter: t.filter,
    has: t.has,
    sort: t.sort === 'submitted_at' ? undefined : t.sort,
    dir: t.dir === 'desc' ? undefined : t.dir,
    ...extra,
  })
}

export function responsesListQuery(formId: string, t: TableState) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'list', t],
    queryFn: () => api<ResponsesListResponse>(`/api/forms/${formId}/responses${tableQueryString(t, { page: t.page > 1 ? t.page : undefined })}`),
    placeholderData: keepPreviousData,
  })
}

export function responseDetailQuery(formId: string, rid: string, t: TableState) {
  const { page: _page, ...filters } = t
  return queryOptions({
    queryKey: [...responsesKey(formId), 'detail', rid, filters],
    queryFn: () => api<ResponseDetail>(`/api/forms/${formId}/responses/${rid}${tableQueryString(t)}`),
    placeholderData: keepPreviousData,
  })
}

export function summaryQuery(formId: string, s: SummaryState) {
  const qs = toQueryString({
    range: s.range,
    from: s.range === 'custom' ? s.from : undefined,
    to: s.range === 'custom' ? s.to : undefined,
    tz: browserTz,
  })
  return queryOptions({
    queryKey: [...responsesKey(formId), 'summary', s],
    queryFn: () => api<SummaryResponse>(`/api/forms/${formId}/summary${qs}`),
    placeholderData: keepPreviousData,
  })
}

export function prefsQuery(formId: string) {
  return queryOptions({
    queryKey: [...responsesKey(formId), 'prefs'],
    queryFn: () => api<TablePrefsResponse>(`/api/forms/${formId}/responses/prefs`),
    staleTime: Infinity,
  })
}

/** PUT is not in lib/api's method list; same error handling. */
async function putJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiRequestError(0, { code: 'offline', message: 'Can’t reach the server. Check your connection and try again.' })
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, (data as ApiErrorBody | null)?.error ?? { code: 'unknown', message: 'Something went wrong. Try again.' })
  return data as T
}

export function useSavePrefs(formId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (columns: TableColumnPref[]) => putJson<TablePrefsResponse>(`/api/forms/${formId}/responses/prefs`, { columns }),
    onMutate: (columns) => qc.setQueryData(prefsQuery(formId).queryKey, { columns }),
    onError: (err) => toast.error(`Columns weren’t saved. ${errorMessage(err)}`),
  })
}

export function useDeleteResponses(formId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1
        ? api<BulkDeleteResponse>(`/api/forms/${formId}/responses/${ids[0]}`, { method: 'DELETE' })
        : api<BulkDeleteResponse>(`/api/forms/${formId}/responses/bulk-delete`, { method: 'POST', body: { ids } }),
    onSuccess: ({ deleted }, ids) => {
      toast.success(deleted === 1 ? 'Response deleted' : `${deleted} responses deleted`)
      // Drop the deleted ones first so an open drawer doesn't refetch a 404.
      for (const id of ids) qc.removeQueries({ queryKey: [...responsesKey(formId), 'detail', id] })
      // List, summary and the neighbours' prev/next links changed; column prefs did not.
      void qc.invalidateQueries({ queryKey: responsesKey(formId), predicate: (q) => q.queryKey[2] !== 'prefs' })
      // Response counts on the Forms list and Contacts: refresh when next shown. The open builder's
      // form detail is left alone (its store was built at mount and never reads it again).
      void qc.invalidateQueries({ queryKey: ['forms', 'list'], refetchType: 'none' })
      void qc.invalidateQueries({ queryKey: ['contacts'], refetchType: 'none' })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

export function csvUrl(formId: string, t: TableState, ids: string[] = []) {
  return `/api/forms/${formId}/responses.csv${ids.length ? toQueryString({ tz: browserTz, ids, sort: t.sort, dir: t.dir }) : tableQueryString(t)}`
}
