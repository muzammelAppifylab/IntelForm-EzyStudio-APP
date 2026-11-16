import * as z from 'zod'

/**
 * Exports (CSV / ZIP) are built by a background job, never in a request (docs/agent/performance.md:
 * a big CSV never runs in a request). The dashboard starts one, polls it, then downloads it:
 *
 *   POST /site-api/exports                 {kind, formId?, query?} → 202 ExportStatus
 *   GET  /site-api/exports/:id             ExportStatus (the person who started it only)
 *   GET  /site-api/exports/:id/download    the file, once `status` is `ready`
 *
 * kind `responses`: one form's CSV (site:response:read), `query` = the table's filters or `ids`;
 * kind `contacts`: the contacts CSV (site:contact:read), `query` = the list's filters or `key`;
 * kind `all`: every form's CSV in one ZIP (site:intelform:settings).
 * A responses CSV is always newest first (the order the database keeps them in); a contacts
 * CSV follows the list's sort.
 */

export const EXPORT_KINDS = ['responses', 'contacts', 'all'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

/** The query string the list or table would send, as repeated keys (`filter`, `ids`, `key`, …). */
const queryRecord = z.record(z.string().max(40), z.union([z.string().max(2000), z.array(z.string().max(2000)).max(1000)]))

export const startExportInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('responses'), formId: z.uuid(), query: queryRecord.default({}) }),
  z.object({ kind: z.literal('contacts'), query: queryRecord.default({}) }),
  z.object({ kind: z.literal('all') }),
])
export type StartExportInput = z.infer<typeof startExportInput>

export type ExportState = 'running' | 'ready' | 'failed'

export interface ExportStatus {
  id: string
  kind: ExportKind
  status: ExportState
  /** Rows written so far (responses or contacts). */
  rows: number
  fileName: string
  /** Words for people when `status` is `failed`. */
  error: string | null
  createdAt: string
}

/** How often the dashboard asks while an export runs (ms). */
export const EXPORT_POLL_MS = 1500
