import {SUMMARY_RANGES, toQueryString, type SummaryRange} from '../../../lib/intelform/api-responses';

/**
 * The Responses tab's view state, all of it in the URL so every view can be linked (owner
 * notification emails link `?response=<id>`) and charts can open the table filtered to what was
 * clicked (legacy responses/queries.ts `useResponsesUrl`). Pure: no React, no router.
 *
 *   ?view=table&q=&tfrom=&tto=&filter=f_x:o_y&has=f_x&sort=&dir=&response=<id>   (table, drawer)
 *   ?range=7d|30d|90d|all|custom&from=&to=                                     (summary)
 *
 * The table's dates are `t`-prefixed to keep them apart from the summary's range. Paging is by
 * keyset cursor ("Load more"), so there is no page number in the URL.
 */

/** The router's parsed search object (values may arrive as numbers or arrays). */
export type Search = Record<string, unknown>;
/** A URL patch: null / undefined / '' / [] remove a key. */
export type SearchPatch = Record<string, string | number | readonly string[] | null | undefined>;

export const RESPONSES_API = '/site-api/responses';

export const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

export interface TableState {
  q: string;
  from?: string;
  to?: string;
  filter: string[];
  has?: string;
  sort: string;
  dir: 'asc' | 'desc';
}

export interface SummaryState {
  range: SummaryRange;
  from?: string;
  to?: string;
}

export type ResponsesView = 'summary' | 'table';

function one(v: unknown): string | undefined {
  if (Array.isArray(v)) return one(v[0]);
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

function many(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  const list = Array.isArray(v) ? v : [v];
  return list.map(one).filter((x): x is string => x !== undefined);
}

export function readView(search: Search): ResponsesView {
  return one(search.view) === 'table' ? 'table' : 'summary';
}

export function readResponseId(search: Search): string | null {
  return one(search.response) ?? null;
}

export function readTableState(search: Search): TableState {
  return {
    q: one(search.q) ?? '',
    from: one(search.tfrom),
    to: one(search.tto),
    filter: many(search.filter),
    has: one(search.has),
    sort: one(search.sort) ?? 'submitted_at',
    dir: one(search.dir) === 'asc' ? 'asc' : 'desc',
  };
}

export function readSummaryState(search: Search): SummaryState {
  const range = one(search.range) as SummaryRange | undefined;
  return {
    range: range && SUMMARY_RANGES.includes(range) ? range : '30d',
    from: one(search.from),
    to: one(search.to),
  };
}

/** The next search object: `patch` over `prev`, removing empty values. */
export function applySearchPatch(prev: Search, patch: SearchPatch): Search {
  const next: Search = {...prev};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = Array.isArray(v) ? [...v] : v;
  }
  return next;
}

/** A table filter changes what is listed (the sort does not). */
export function isTableFiltered(t: TableState): boolean {
  return !!(t.q || t.from || t.to || t.filter.length || t.has);
}

/** The URL patch that clears every table filter. */
export const CLEAR_TABLE_FILTERS: SearchPatch = {q: null, tfrom: null, tto: null, filter: null, has: null};

/** Query string for the API's filter schema (defaults left out). */
export function tableQueryString(t: TableState, extra: Record<string, string | number | readonly string[] | undefined | null> = {}) {
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
  });
}

export function summaryQueryString(s: SummaryState) {
  return toQueryString({
    range: s.range,
    from: s.range === 'custom' ? s.from : undefined,
    to: s.range === 'custom' ? s.to : undefined,
    tz: browserTz,
  });
}

export const formResponsesPath = (formId: string) => `${RESPONSES_API}/forms/${encodeURIComponent(formId)}`;

/** The CSV download: the table's filters and sort, or only the selected rows (in the table's sort). */
export function csvUrl(formId: string, t: TableState, ids: readonly string[] = []) {
  const qs = ids.length
    ? toQueryString({tz: browserTz, ids, sort: t.sort === 'submitted_at' ? undefined : t.sort, dir: t.dir === 'desc' ? undefined : t.dir})
    : tableQueryString(t);
  return `${formResponsesPath(formId)}/responses.csv${qs}`;
}

/** Summary → table: the chart's date range is kept so the counts match; other table filters reset. */
export function summaryToTablePatch(range: {from: string; to: string}, patch: SearchPatch): SearchPatch {
  return {
    view: 'table',
    ...CLEAR_TABLE_FILTERS,
    sort: null,
    dir: null,
    tfrom: range.from,
    tto: range.to,
    ...patch,
  };
}

/** Clicking a column header: same column flips the direction; another column sorts ascending (submitted: newest first). */
export function sortPatch(t: TableState, id: string): SearchPatch {
  if (t.sort === id) return {dir: t.dir === 'asc' ? 'desc' : 'asc'};
  return {sort: id === 'submitted_at' ? null : id, dir: id === 'submitted_at' ? null : 'asc'};
}

/** Keys that move between responses in the drawer: ← / K previous, → / J next. */
export function navKey(key: string): 'prev' | 'next' | null {
  const k = key.toLowerCase();
  if (k === 'arrowleft' || k === 'k') return 'prev';
  if (k === 'arrowright' || k === 'j') return 'next';
  return null;
}

/** The confirm dialog's words for deleting `count` responses (legacy ConfirmDelete.tsx). */
export function deleteCopy(count: number) {
  const one = count === 1;
  return {
    title: one ? 'Delete this response?' : `Delete ${count} responses?`,
    body: `${one ? 'Its answers are removed for good' : 'Their answers are removed for good'} and the summary updates. Export a CSV first if you need a copy.`,
    confirmLabel: one ? 'Delete response' : `Delete ${count} responses`,
  };
}
