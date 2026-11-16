import { Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { sql, withoutStatementTimeout } from '../db/client'
import { CSV_BOM, csvRow } from './csv'

/**
 * "Export all responses" (Settings → Data): a ZIP with one CSV per form, streamed.
 *
 * Each form's CSV is the same as its responses export (one column per question): routes/responses.ts
 * registers that exporter with `registerFormCsvExporter` when app.ts imports it. The generic
 * columns below are only a fallback if nothing is registered.
 *
 * An exporter yields CSV text chunks (BOM first), and should read rows with a cursor inside
 * `withoutStatementTimeout` (server/db/client.ts), or a long export hits statement_timeout.
 */
export interface ExportForm {
  id: string
  slug: string
  title: string
}

export type FormCsvExporter = (form: ExportForm) => AsyncIterable<string>

/** Generic fallback: submitted_at, response id and the raw answers as JSON. */
export const genericFormCsv: FormCsvExporter = async function* (form) {
  yield CSV_BOM + csvRow(['response_id', 'submitted_at', 'country', 'device', 'browser', 'answers_json'])
  // A cursor is one statement for its whole life: lift the pool's statement_timeout while streaming.
  yield* withoutStatementTimeout(async function* (db) {
    const cursor = db<{ id: string; submitted_at: Date; country: string | null; device: string | null; browser: string | null; answers: unknown }[]>`
      SELECT id, submitted_at, country, device, browser, answers FROM responses
      WHERE form_id = ${form.id} ORDER BY submitted_at
    `.cursor(500)
    for await (const rows of cursor) {
      yield rows.map((r) => csvRow([r.id, r.submitted_at, r.country, r.device, r.browser, JSON.stringify(r.answers)])).join('')
    }
  })
}

let exporter: FormCsvExporter = genericFormCsv

export function registerFormCsvExporter(fn: FormCsvExporter): void {
  exporter = fn
}

function entryName(form: ExportForm, used: Set<string>): string {
  const base = (form.slug || form.id).replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'form'
  let name = `${base}.csv`
  for (let i = 2; used.has(name); i++) name = `${base}-${i}.csv`
  used.add(name)
  return name
}

/** A web ReadableStream of the ZIP. Entries are written one after another (archiver queues them). */
export async function exportAllResponsesZip(): Promise<ReadableStream<Uint8Array>> {
  const forms = await sql<ExportForm[]>`SELECT id, slug, title FROM forms ORDER BY created_at`
  const zip = new ZipArchive({ zlib: { level: 6 } })
  const used = new Set<string>()
  for (const form of forms) {
    zip.append(Readable.from(exporter(form)), { name: entryName(form, used), date: new Date() })
  }
  if (!forms.length) zip.append('No forms yet.\r\n', { name: 'README.txt' })
  void zip.finalize()
  return Readable.toWeb(zip) as unknown as ReadableStream<Uint8Array>
}
