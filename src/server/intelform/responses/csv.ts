import type {ResponsesCsvQuery} from '../../../lib/intelform/api-responses';
import {responsesCsvQuery} from '../../../lib/intelform/api-responses';
import type {FormField} from '../../../lib/intelform/form/definition';
import {answerToCsv, csvHeaders} from '../../../lib/intelform/form/csv';
import {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import type {FormCatalog} from './catalog';
import {CSV_BOM, csvRow, type CsvCell} from './csv-text';
import {displayAnswer} from './format';
import {cursorCte, keysetFragments, orderFragment, safeTz, sortSpec, whereFragment, type Cursor} from './query';

/**
 * CSV for one form ("CSV export"): BOM, one column per field (split name and address use
 * several, via csvHeaders), multiple choice joined with "; ", signature as its URL, then
 * submitted at, completion time, device, browser, country and response id.
 *
 * Rows are read in keyset batches of BATCH rows in the table's order (IntelForm used a
 * postgres.js cursor; the platform's database connection has none), so memory stays flat for
 * any size: one batch is in memory at a time, and the next is read only when the reader has
 * taken the previous one (a pull-based stream).
 */

const sql = Prisma.sql;
export const BATCH = 500;

/** One field's cells. A signature column holds only URLs of files this site stored. */
function csvCells(field: FormField, value: unknown): CsvCell[] {
  if (field.type !== 'signature' || value === undefined || value === null) return answerToCsv(field, value);
  const d = displayAnswer(field, value);
  return [d.url ?? d.text];
}

const META_HEADERS = ['Submitted at', 'Completion time (seconds)', 'Device', 'Browser', 'Country', 'Response ID'];

export function headerRow(cat: FormCatalog): string {
  const fieldHeaders = cat.entries.flatMap(e => {
    const hs = csvHeaders(e.plain);
    return e.meta.deleted ? hs.map(h => `${h} (deleted)`) : hs;
  });
  return csvRow([...fieldHeaders, ...META_HEADERS]);
}

export interface CsvRowData {
  id: string;
  submitted: string;
  duration_ms: number | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  answers: Record<string, unknown>;
}

/** One data line. Exported for unit tests. */
export function dataRow(cat: FormCatalog, r: CsvRowData): string {
  const answers = r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers) ? r.answers : {};
  const cells: CsvCell[] = cat.entries.flatMap(e => csvCells(e.plain, answers[e.meta.id]));
  const ms = r.duration_ms === null ? null : Number(r.duration_ms);
  cells.push(r.submitted, ms === null ? null : Math.round(ms / 100) / 10, r.device, r.browser, r.country, r.id);
  return csvRow(cells);
}

export interface CsvOptions {
  /** Called between batches; return true to stop (client went away). */
  aborted?: () => boolean;
}

/** CSV text chunks for a form, BOM and header first, then one chunk per batch. */
export async function* formCsvChunks(
  db: PrismaClient,
  cat: FormCatalog,
  query: ResponsesCsvQuery,
  opts: CsvOptions = {}
): AsyncGenerator<string> {
  const tz = safeTz(query.tz);
  const where = query.ids.length ? sql`form_id = ${cat.form.id}::uuid AND id = ANY(${query.ids}::uuid[])` : whereFragment(cat, query, tz);
  const sort = sortSpec(cat, query.sort, query.dir);
  const order = orderFragment(sort);
  const {after} = keysetFragments(sort);
  yield CSV_BOM + headerRow(cat);
  let cursor: Cursor | null = null;
  for (;;) {
    if (opts.aborted?.()) return;
    const select = sql`SELECT id, to_char(submitted_at AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS submitted,
        duration_ms, device, browser, country, answers, (${sort.expr})::text AS sort_key`;
    const batch: (CsvRowData & {sort_key: string | null})[] = await db.$queryRaw<(CsvRowData & {sort_key: string | null})[]>(
      cursor
        ? sql`WITH ${cursorCte(cursor, sort.type)} ${select} FROM responses, cur WHERE ${where} AND ${after} ORDER BY ${order} LIMIT ${BATCH}`
        : sql`${select} FROM responses WHERE ${where} ORDER BY ${order} LIMIT ${BATCH}`
    );
    if (!batch.length) return;
    let chunk = '';
    for (const r of batch) chunk += dataRow(cat, r);
    yield chunk;
    if (batch.length < BATCH) return;
    const last = batch[batch.length - 1];
    cursor = {k: last.sort_key, id: last.id};
  }
}

/** Every response of the form, newest first like the table (the "Export all responses" ZIP). */
export function exportFormCsv(db: PrismaClient, cat: FormCatalog, opts: CsvOptions = {}): AsyncGenerator<string> {
  return formCsvChunks(db, cat, responsesCsvQuery.parse({}), opts);
}

export function csvFilename(cat: {title: string; slug: string}, today: string): string {
  const base =
    (cat.title || cat.slug)
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .trim()
      .slice(0, 80) || 'responses';
  return `${base} responses ${today}.csv`;
}

const encoder = new TextEncoder();

/**
 * A byte stream of text chunks, read one chunk per pull (backpressure), the generator closed
 * when the reader cancels. Errors after the first byte can't change the status: a short line
 * says the export failed, then the stream ends.
 */
export function byteStream(
  chunks: AsyncGenerator<string | Uint8Array>,
  onError: (err: unknown) => void,
  /** Appended on failure; null errors the stream instead (a ZIP can't take a trailing note). */
  failText: string | null = '\r\nExport failed. Try again.\r\n'
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const {value, done} = await chunks.next();
          if (done) controller.close();
          else controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value);
        } catch (err) {
          onError(err);
          if (failText === null) {
            controller.error(err);
            return;
          }
          controller.enqueue(encoder.encode(failText));
          controller.close();
        }
      },
      async cancel() {
        await chunks.return(undefined);
      },
    },
    // Nothing is read before the client asks: no query runs ahead of the reader.
    {highWaterMark: 0}
  );
}
