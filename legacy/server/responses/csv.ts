import type { ResponsesCsvQuery } from '../../shared/api-responses'
import { responsesCsvQuery } from '../../shared/api-responses'
import type { FormField } from '../../shared/form/definition'
import { answerToCsv, csvHeaders } from '../../shared/form/csv'
import { sql, withoutStatementTimeout } from '../db/client'
import { CSV_BOM, csvRow, type CsvCell } from '../lib/csv'
import type { ExportForm } from '../lib/data-export'
import { loadCatalog, type FormCatalog } from './catalog'
import { displayAnswer } from './format'
import { orderFragment, safeTz, sortSpec, whereFragment } from './query'

/**
 * Streamed CSV for one form (PRD "CSV export"): BOM, one column per field (split name and
 * address use several, via csvHeaders), multiple choice joined with "; ", signature as its URL,
 * then submitted at, completion time and device. Rows come from a postgres.js cursor, so memory
 * stays flat for any size. Used by GET /api/forms/:id/responses.csv and the "Export all
 * responses" ZIP (registered with server/lib/data-export.ts in server/routes/responses.ts).
 */

const CURSOR_ROWS = 500

/** One field's cells. A signature column holds only URLs of PNGs this server stored. */
function csvCells(field: FormField, value: unknown): CsvCell[] {
  if (field.type !== 'signature' || value === undefined || value === null) return answerToCsv(field, value)
  const d = displayAnswer(field, value)
  return [d.url ?? d.text]
}
const META_HEADERS = ['Submitted at', 'Completion time (seconds)', 'Device', 'Browser', 'Country', 'Response ID']

function headerRow(cat: FormCatalog): string {
  const fieldHeaders = cat.entries.flatMap((e) => {
    const hs = csvHeaders(e.plain)
    return e.meta.deleted ? hs.map((h) => `${h} (deleted)`) : hs
  })
  return csvRow([...fieldHeaders, ...META_HEADERS])
}

export interface CsvOptions {
  /** Called between chunks; return true to stop (client went away). */
  aborted?: () => boolean
  /** The form's catalog, when the caller has loaded it already. */
  catalog?: FormCatalog
}

/** CSV text chunks for a form, BOM first. */
export async function* formCsvChunks(formId: string, query: ResponsesCsvQuery, opts: CsvOptions = {}): AsyncGenerator<string> {
  const cat = opts.catalog ?? (await loadCatalog(formId))
  const tz = await safeTz(query.tz)
  const where = query.ids.length
    ? sql`form_id = ${formId} AND id = ANY(${sql.array(query.ids)}::uuid[])`
    : whereFragment(cat, query, tz)
  const order = orderFragment(sortSpec(cat, query.sort, query.dir))
  yield CSV_BOM + headerRow(cat)
  // A cursor is one statement for its whole life: lift the pool's statement_timeout while streaming.
  yield* withoutStatementTimeout(async function* (db) {
    const cursor = db<{ id: string; submitted: string; duration_ms: number | null; device: string | null; browser: string | null; country: string | null; answers: Record<string, unknown> }[]>`
      SELECT id, to_char(submitted_at AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS submitted, duration_ms, device, browser, country, answers
      FROM responses WHERE ${where} ORDER BY ${order}
    `.cursor(CURSOR_ROWS)
    // Breaking out of for-await closes the cursor (postgres.js cancels the rest).
    for await (const rows of cursor) {
      if (opts.aborted?.()) return
      let chunk = ''
      for (const r of rows) {
        const cells: CsvCell[] = cat.entries.flatMap((e) => csvCells(e.plain, r.answers[e.meta.id]))
        cells.push(r.submitted, r.duration_ms === null ? null : Math.round(r.duration_ms / 100) / 10, r.device, r.browser, r.country, r.id)
        chunk += csvRow(cells)
      }
      yield chunk
    }
  })
}

/** For the data-export ZIP: every response of the form, newest first like the table. */
export function exportFormCsv(form: ExportForm): AsyncIterable<string> {
  return formCsvChunks(form.id, responsesCsvQuery.parse({}))
}

export function csvFilename(cat: { title: string; slug: string }, today: string): string {
  const base = (cat.title || cat.slug).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'responses'
  return `${base} responses ${today}.csv`
}
