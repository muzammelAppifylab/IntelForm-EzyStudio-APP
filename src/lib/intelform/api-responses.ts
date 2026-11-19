import * as z from 'zod'
import type { FieldType } from './form/field-types'

/**
 * Request schemas and response shapes for the Responses tab (Agent G):
 *   GET    /site-api/responses/forms/:id/responses   table page (filters, search, sort, keyset cursor)
 *   GET    /site-api/responses/forms/:id/responses/:rid        drawer (labels as submitted, prev / next)
 *   DELETE /site-api/responses/forms/:id/responses/:rid
 *   POST   /site-api/responses/forms/:id/responses/bulk-delete
 *   GET    /site-api/responses/forms/:id/summary               aggregates, funnel, time series
 *   GET    /site-api/responses/forms/:id/responses/prefs       table columns for this user
 *   PUT    /site-api/responses/forms/:id/responses/prefs
 * The CSV (same filters, or ids) and the all-forms ZIP are export jobs: api-exports.ts.
 */

export const RESPONSES_PAGE_SIZE = 50

/** Non-field table columns. Field columns use the field id. */
export const META_COLUMNS = ['submitted_at', 'duration', 'device', 'browser', 'country'] as const
export type MetaColumn = (typeof META_COLUMNS)[number]
export const META_COLUMN_LABEL: Record<MetaColumn, string> = {
  submitted_at: 'Submitted',
  duration: 'Completion time',
  device: 'Device',
  browser: 'Browser',
  country: 'Country',
}

/** Days from `from` to `to` (YYYY-MM-DD, both valid), counted in UTC. */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** A real calendar day: 2026-02-30 and 2026-13-45 fail here (422), not in SQL (500). */
export function isRealDay(v: string): boolean {
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealDay, 'Pick a real date')
const columnId = z.string().regex(/^(submitted_at|duration|device|browser|country|f_[a-z0-9]{4,12})$/)

/** "f_abc123:o_x9y8z7": a choice field and one of its values (option id, true / false, country code). */
export const responseFilter = z.string().regex(/^f_[a-z0-9]{4,12}:[A-Za-z0-9_]{1,40}$/)

/**
 * Table filters, shared by the table, the drawer's prev / next and the CSV export.
 * Query string: ?q=&from=&to=&tz=&filter=f_x:o_y&filter=…&has=f_x&sort=&dir=&page=
 */
export const responsesFilterQuery = z.object({
  q: z.string().trim().max(200).optional(),
  /** Local dates in `tz`, inclusive. */
  from: isoDay.optional(),
  to: isoDay.optional(),
  tz: z.string().max(64).optional(),
  /** Choice filters: AND across fields, OR within one field. */
  filter: z.array(responseFilter).max(20).default([]),
  /** Only responses that answered this field ("View all" on a summary card). */
  has: z.string().regex(/^f_[a-z0-9]{4,12}$/).optional(),
  sort: columnId.default('submitted_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})
export type ResponsesFilterQuery = z.infer<typeof responsesFilterQuery>

export const responsesListQuery = responsesFilterQuery.extend({
  /** Echoed back only: paging is by `cursor`. */
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  /** The previous page's `nextCursor`. */
  cursor: z.string().max(1000).optional(),
})
export type ResponsesListQuery = z.infer<typeof responsesListQuery>

/** CSV export: the filters, or just the selected rows. */
export const responsesCsvQuery = responsesFilterQuery.extend({
  ids: z.array(z.uuid()).max(1000).default([]),
})
export type ResponsesCsvQuery = z.infer<typeof responsesCsvQuery>

export const bulkDeleteInput = z.object({
  ids: z.array(z.uuid()).min(1, 'Select at least one response').max(1000, 'Delete at most 1,000 responses at a time'),
})
export type BulkDeleteInput = z.infer<typeof bulkDeleteInput>

export const tableColumnPref = z.object({ id: columnId, visible: z.boolean() })
export type TableColumnPref = z.infer<typeof tableColumnPref>
export const tablePrefsInput = z.object({ columns: z.array(tableColumnPref).max(600) })
export type TablePrefsInput = z.infer<typeof tablePrefsInput>

export const SUMMARY_RANGES = ['7d', '30d', '90d', 'all', 'custom'] as const
export type SummaryRange = (typeof SUMMARY_RANGES)[number]

/** Longest custom summary range in days, both ends included (about ten years): the series has one row per day. */
export const MAX_SUMMARY_DAYS = 3660

export const summaryQuery = z
  .object({
    range: z.enum(SUMMARY_RANGES).default('30d'),
    from: isoDay.optional(),
    to: isoDay.optional(),
    tz: z.string().max(64).optional(),
  })
  .refine((v) => v.range !== 'custom' || (v.from && v.to && v.from <= v.to), {
    message: 'Pick a start and end date',
    path: ['from'],
  })
  .refine((v) => v.range !== 'custom' || !v.from || !v.to || daySpan(v.from, v.to) + 1 <= MAX_SUMMARY_DAYS, {
    message: 'Pick a range of ten years or less',
    path: ['from'],
  })
export type SummaryQuery = z.infer<typeof summaryQuery>

// ---------------------------------------------------------------------------------------
// Response shapes

export interface CatalogOption {
  id: string
  label: string
  /** Removed from the published form; still shown for old answers. */
  deleted: boolean
}

/** One answer column: current label from the published version, or the last known one + deleted. */
export interface CatalogField {
  id: string
  type: FieldType
  label: string
  deleted: boolean
  /** Choice-like fields: options in form order (deleted ones last). Yes / No: "true" / "false". */
  options?: CatalogOption[]
  /** Values can be used in ?filter=. */
  filterable: boolean
}

export interface ResponseRow {
  id: string
  submittedAt: string
  durationMs: number | null
  device: string | null
  browser: string | null
  country: string | null
  /** Display text per field id (current labels). Missing key = not answered. */
  cells: Record<string, string>
  /** Signature image URL per field id; set only for files the server stored. */
  urls?: Record<string, string>
}

export interface ResponsesListResponse {
  fields: CatalogField[]
  rows: ResponseRow[]
  /** Matching the filters. */
  total: number
  /** All responses of the form, unfiltered (empty state vs. "no matches"). */
  formTotal: number
  page: number
  pageSize: number
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null
  /** A filtered total stops at 10,000: show "10,000+". */
  totalCapped: boolean
}

export interface DrawerAnswer {
  fieldId: string
  type: FieldType
  /** Label as it was on the response's form version (pipes resolved). */
  label: string
  /** Display text; '' when unanswered. */
  text: string
  /** Signature image URL. */
  url?: string
  /** A rich text answer as sanitized HTML (sanitize again before showing it). */
  html?: string
}

export interface ResponseDetail {
  id: string
  formVersion: number
  submittedAt: string
  startedAt: string | null
  durationMs: number | null
  device: string | null
  browser: string | null
  country: string | null
  answers: DrawerAnswer[]
  /** Neighbours in the current filter and sort; null at either end. */
  prevId: string | null
  nextId: string | null
}

export interface BulkDeleteResponse {
  deleted: number
}

export interface TablePrefsResponse {
  /** Null until the user changes the columns. */
  columns: TableColumnPref[] | null
}

export interface LatestAnswer {
  responseId: string
  submittedAt: string
  text: string
}

export interface ChoiceSummaryOption {
  id: string
  label: string
  count: number
  /** Of respondents who answered the question (multiple choice can add up past 100). */
  pct: number
  deleted?: boolean
  /** The "Other" option. */
  other?: boolean
}

export type QuestionData =
  | { kind: 'choice'; options: ChoiceSummaryOption[]; other: LatestAnswer[] }
  | { kind: 'rating'; scale: number; average: number | null; distribution: { value: number; count: number }[]; csat: number | null }
  | {
      kind: 'nps'
      score: number | null
      detractors: number
      passives: number
      promoters: number
      distribution: { value: number; count: number }[]
    }
  | { kind: 'number'; average: number | null; min: number | null; max: number | null; median: number | null }
  | { kind: 'latest'; items: LatestAnswer[] }
  | { kind: 'count'; count: number; noun: 'signed' | 'accepted' }

export interface QuestionSummary {
  fieldId: string
  type: FieldType
  label: string
  deleted: boolean
  /** Responses in range that answered this question. */
  answered: number
  /** Median time spent on this question (ms), from per-question timings. */
  medianTimeMs: number | null
  data: QuestionData
}

export interface SummaryResponse {
  range: { preset: SummaryRange; from: string; to: string; tz: string }
  totals: {
    views: number
    starts: number
    responses: number
    /** responses ÷ starts, capped at 1; null without starts. */
    completionRate: number | null
    avgMs: number | null
    medianMs: number | null
  }
  /** Responses per local day, every day in range. */
  series: { day: string; count: number }[]
  questions: QuestionSummary[]
  /** All responses of the form, ignoring the range. */
  formTotal: number
}

/** Builds the query string for the filter schemas above (arrays as repeated keys). */
export function toQueryString(params: Record<string, string | number | readonly string[] | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) for (const x of v) sp.append(k, String(x))
    else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
