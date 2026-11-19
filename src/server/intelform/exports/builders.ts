import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {contactsCsvQuery, type ContactsCsvQuery} from '../../../lib/intelform/api-contacts';
import type {ExportKind} from '../../../lib/intelform/api-exports';
import {responsesCsvQuery, type ResponsesCsvQuery} from '../../../lib/intelform/api-responses';
import {applyContactQueue} from '../contacts/apply';
import {contactsCsvBatch, contactsCsvHeader} from '../contacts/query';
import type {ContactCursor} from '../contacts/sql';
import {loadCatalog, type FormCatalog} from '../responses/catalog';
import {dataRow, headerRow, type CsvRowData} from '../responses/csv';
import {CSV_BOM} from '../responses/csv-text';
import {safeTz, whereFragment} from '../responses/query';
import {centralEntry, crc32, dataDescriptor, dosDateTime, endOfDirectory, entryName, localHeader, ZIP_LIMIT} from '../responses/zip';
import {ExportError} from './errors';

/**
 * The pieces an export is built from, one bounded step at a time (job.ts calls `buildPart`
 * until its run's time is up, writing a part each PART_BYTES). Every step is a single indexed
 * query and returns the progress to save, so a run can stop after any step and the next one
 * carries on:
 *
 *   responses  one form's CSV, newest first: keyset on (submitted_at, id), the order of the
 *              responses_form_id_submitted_at_id index, whatever the table's sort. Rows a step
 *              from the form's width (`batchRows`), so a wide form's batch stays a few MB
 *   contacts   the contacts CSV, 1,000 a step from the contacts table in the list's sort (keyset)
 *   all        a ZIP of every form's CSV (STORE, zip.ts): forms 20 ids at a time, each form's
 *              catalog read when its file starts, rows as above; CRC-32 and offsets in the progress
 *
 * A form's catalog (one row, responses/catalog.ts) is read once per run and kept on the context.
 * An unfiltered export is sized from its first batch and refused at once when it can't fit.
 */

export interface BuildContext {
  db: PrismaClient;
  kind: ExportKind;
  formId: string | null;
  params: Record<string, unknown>;
  /** The catalog in use this run, of form `catalogOf` (not saved: re-read in one query by the next run). */
  catalog?: FormCatalog | null;
  catalogOf?: string;
  /** Bytes of the export before this step (sizes it early). */
  written?: number;
  /** Rows the current file may still take (job.ts): a batch never runs past the file's cap. */
  rowsLeft?: number;
}

/** A batch's rows for this form, never past what the current file may still take. */
const rowsFor = (ctx: BuildContext, fields: number) => Math.max(1, Math.min(batchRows(fields), ctx.rowsLeft ?? Infinity));

export type BuildState = Record<string, unknown>;

export interface Built {
  bytes: Uint8Array;
  rows: number;
  state: BuildState;
  done: boolean;
  /** The last step of a later file that holds nothing (job.ts keeps no file for it). */
  empty?: boolean;
}

const encoder = new TextEncoder();
const sql = Prisma.sql;
/** Response rows per step, at most (a narrow form). */
export const RESPONSE_BATCH = 500;
/** Answer cells per step: a 500-field form reads 50 rows a step, a 50-field one 500. */
const BATCH_CELLS = 25_000;
/** Response rows per step, at least. */
const MIN_BATCH = 50;
/** Forms per step of the all-forms ZIP. */
const FORM_BATCH = 20;
/** A file past this stops with a message (stays well inside a Worker's memory and the ZIP limit). */
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;

/** Rows a step for a form with this many fields: a batch's memory is about rows × fields. */
export function batchRows(fields: number): number {
  return Math.max(MIN_BATCH, Math.min(RESPONSE_BATCH, Math.floor(BATCH_CELLS / Math.max(1, fields))));
}

const MB = 1024 * 1024;

/**
 * The whole file's size from its first batch: what is written, plus the rest of the form's rows
 * at this batch's average. Throws when it can't fit, before hours of work.
 */
export function checkEstimate(written: number, batchBytes: number, batchRows_: number, totalRows: number, what: string): void {
  if (batchRows_ <= 0) return;
  const estimate = written + batchBytes + (batchBytes / batchRows_) * Math.max(0, totalRows - batchRows_);
  if (estimate > MAX_EXPORT_BYTES) {
    throw new ExportError(
      `${what} would be about ${Math.ceil(estimate / MB).toLocaleString('en-US')} MB, more than the ${MAX_EXPORT_BYTES / MB} MB one export can hold. ` +
        'Narrow it with filters (a date range), or export fewer responses.'
    );
  }
}

/** No filter at all: every response of the form is in the file (its count sizes the file). */
function unfiltered(q: ResponsesCsvQuery): boolean {
  return !q.ids.length && !q.q && !q.from && !q.to && !q.filter.length && !q.has;
}

interface RowCursor {
  at: string;
  id: string;
}

const isCursor = (v: unknown): v is RowCursor =>
  !!v && typeof v === 'object' && typeof (v as RowCursor).at === 'string' && typeof (v as RowCursor).id === 'string';

/** The CSV of one form, as stored in an export's params. */
export function responsesParams(params: Record<string, unknown>): {query: ResponsesCsvQuery; tz: string; origin: string | null} {
  const query = responsesCsvQuery.parse(params.query ?? {});
  return {query, tz: safeTz(typeof params.tz === 'string' ? params.tz : query.tz), origin: typeof params.origin === 'string' ? params.origin : null};
}

/** One batch of a form's rows after `cursor`, newest first (index order). */
export async function responsesBatch(
  db: PrismaClient,
  cat: FormCatalog,
  query: ResponsesCsvQuery,
  tz: string,
  origin: string | null,
  cursor: RowCursor | null,
  limit = batchRows(cat.entries.length)
): Promise<{text: string; rows: number; next: RowCursor | null}> {
  const where = query.ids.length ? sql`form_id = ${cat.form.id}::uuid AND id = ANY(${query.ids}::uuid[])` : whereFragment(cat, query, tz);
  const after = cursor ? sql`(submitted_at, id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql`true`;
  const batch = await db.$queryRaw<(CsvRowData & {at: string})[]>`
    SELECT id::text AS id, to_char(submitted_at AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS submitted,
      to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
      duration_ms, device, browser, country, answers
    FROM responses WHERE ${where} AND ${after}
    ORDER BY submitted_at DESC, id DESC
    LIMIT ${limit}
  `;
  const lines = batch.map(r => dataRow(cat, r, origin));
  const last = batch.at(-1);
  return {text: lines.join(''), rows: batch.length, next: batch.length === limit && last ? {at: last.at, id: last.id} : null};
}

async function responsesStep(ctx: BuildContext, state: BuildState): Promise<Built> {
  const {query, tz, origin} = responsesParams(ctx.params);
  const cat = ctx.formId ? await catalogFor(ctx, ctx.formId) : null;
  if (!cat) throw new ExportError('The form was deleted while it was being exported.');
  if (!state.started) {
    return {bytes: encoder.encode(CSV_BOM + headerRow(cat)), rows: 0, state: {started: true, cur: null}, done: false};
  }
  const cursor = isCursor(state.cur) ? state.cur : null;
  const b = await responsesBatch(ctx.db, cat, query, tz, origin, cursor, rowsFor(ctx, cat.entries.length));
  const bytes = encoder.encode(b.text);
  // The first rows size the whole file (an unfiltered one: the form's count is its row count).
  if (!cursor && b.next && unfiltered(query)) {
    checkEstimate(ctx.written ?? 0, bytes.length, b.rows, cat.form.responseCount, 'This export');
  }
  return {bytes, rows: b.rows, state: {started: true, cur: b.next}, done: !b.next};
}

async function contactsStep(ctx: BuildContext, state: BuildState): Promise<Built> {
  const query: ContactsCsvQuery = contactsCsvQuery.parse(ctx.params.query ?? {});
  const tz = safeTz(typeof ctx.params.tz === 'string' ? ctx.params.tz : query.tz);
  if (!state.started) {
    // Responses since the last notify run go into `contacts` first, so the file has every one.
    await applyContactQueue(ctx.db, {budgetMs: 5_000});
    return {bytes: encoder.encode(contactsCsvHeader()), rows: 0, state: {started: true, cur: null}, done: false};
  }
  const cur = state.cur as ContactCursor | null;
  const b = await contactsCsvBatch(ctx.db, query, tz, cur && typeof cur.k === 'string' ? cur : null);
  return {bytes: encoder.encode(b.text), rows: b.rows, state: {started: true, cur: b.next}, done: !b.next};
}

// ------------------------------------------------------------------ The all-forms ZIP

/** A finished ZIP entry: [name, crc, size, offset, time, date]. */
type DirTuple = [string, number, number, number, number, number];

interface ZipEntryState {
  formId: string;
  name: string;
  cursor: RowCursor | null;
  started: boolean;
  crc: number;
  size: number;
  start: number;
  time: number;
  date: number;
}

interface ZipState {
  formAfter: RowCursor | null;
  queue: string[];
  formsDone: boolean;
  cur: ZipEntryState | null;
  dir: DirTuple[];
  offset: number;
  used: string[];
  /** Entries written in any file of this export (the README is only for none at all). */
  entries: number;
}

function zipState(s: BuildState): ZipState {
  return {
    formAfter: isCursor(s.formAfter) ? s.formAfter : null,
    queue: Array.isArray(s.queue) ? (s.queue as string[]) : [],
    formsDone: s.formsDone === true,
    cur: (s.cur as ZipEntryState | null) ?? null,
    dir: Array.isArray(s.dir) ? (s.dir as DirTuple[]) : [],
    offset: Number(s.offset ?? 0),
    used: Array.isArray(s.used) ? (s.used as string[]) : [],
    entries: Number(s.entries ?? 0),
  };
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The form's catalog: read when its file starts or a new run carries on with it, then kept. */
async function catalogFor(ctx: BuildContext, formId: string): Promise<FormCatalog | null> {
  if (ctx.catalogOf !== formId) {
    ctx.catalog = await loadCatalog(ctx.db, formId);
    ctx.catalogOf = formId;
  }
  return ctx.catalog ?? null;
}

function checkSize(offset: number) {
  if (offset > ZIP_LIMIT) throw new ExportError('This export is too large for one ZIP file.');
}

async function zipStep(ctx: BuildContext, state: BuildState): Promise<Built> {
  const z = zipState(state);
  const origin = typeof ctx.params.origin === 'string' ? ctx.params.origin : null;
  const tz = safeTz(typeof ctx.params.tz === 'string' ? ctx.params.tz : undefined);

  // 1. Inside a form's CSV: its header, then its rows a batch at a time, then its descriptor.
  if (z.cur) {
    const cur = z.cur;
    const cat = await catalogFor(ctx, cur.formId);
    let text = '';
    let rows = 0;
    let finished = false;
    let sizeFrom = 0;
    if (!cat) {
      // Deleted meanwhile: what was written stays a (short) file.
      finished = true;
    } else if (!cur.started) {
      text = CSV_BOM + headerRow(cat);
      cur.started = true;
    } else {
      const first = !cur.cursor;
      const b = await responsesBatch(ctx.db, cat, responsesCsvQuery.parse({}), tz, origin, cur.cursor, rowsFor(ctx, cat.entries.length));
      text = b.text;
      rows = b.rows;
      cur.cursor = b.next;
      finished = !b.next;
      if (first && b.next) sizeFrom = cat.form.responseCount;
    }
    const data = encoder.encode(text);
    // Sized by a form's first rows: its whole file plus everything before it.
    if (sizeFrom) checkEstimate(z.offset, data.length, rows, sizeFrom, 'This ZIP');
    cur.crc = crc32(data, cur.crc);
    cur.size += data.length;
    let bytes = data;
    if (finished) {
      bytes = concat(data, dataDescriptor(cur.crc, cur.size));
      z.dir.push([cur.name, cur.crc, cur.size, cur.start, cur.time, cur.date]);
      z.cur = null;
    }
    z.offset += bytes.length;
    checkSize(z.offset);
    return {bytes, rows, state: {...z}, done: false};
  }

  // 2. The next form of the batch: its local header.
  while (z.queue.length) {
    const formId = z.queue.shift()!;
    const cat = await catalogFor(ctx, formId);
    if (!cat) continue;
    const used = new Set(z.used);
    const name = entryName(cat.form, used);
    z.used = [...used];
    const {time, date} = dosDateTime(new Date());
    const header = localHeader(encoder.encode(name), time, date);
    z.cur = {formId, name, cursor: null, started: false, crc: 0, size: 0, start: z.offset, time, date};
    z.offset += header.length;
    z.entries++;
    if (z.dir.length >= 0xffff) throw new ExportError('Too many forms for one ZIP file.');
    return {bytes: header, rows: 0, state: {...z}, done: false};
  }

  // 3. The next batch of forms (keyset, oldest first), their catalogs in one query.
  if (!z.formsDone) {
    const after = z.formAfter;
    const forms = await ctx.db.$queryRaw<{id: string; at: string}[]>`
      SELECT id::text AS id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
      FROM forms
      WHERE ${after ? sql`(created_at, id) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`}
      ORDER BY created_at, id
      LIMIT ${FORM_BATCH}
    `;
    z.queue = forms.map(f => f.id);
    const last = forms.at(-1);
    if (last) z.formAfter = {at: last.at, id: last.id};
    z.formsDone = forms.length < FORM_BATCH;
    return {bytes: new Uint8Array(0), rows: 0, state: {...z}, done: false};
  }

  // 4. No forms at all: a note, so the archive is never empty.
  const parts: Uint8Array[] = [];
  if (!z.dir.length && !z.entries) {
    const name = encoder.encode('README.txt');
    const body = encoder.encode('No forms yet.\r\n');
    const {time, date} = dosDateTime(new Date());
    const crc = crc32(body);
    const head = localHeader(name, time, date);
    parts.push(head, body, dataDescriptor(crc, body.length));
    z.dir.push(['README.txt', crc, body.length, z.offset, time, date]);
    z.entries++;
    z.offset += head.length + body.length + 16;
  }
  // 5. The central directory and its end record.
  const dirStart = z.offset;
  let dirSize = 0;
  for (const [name, crc, size, offset, time, date] of z.dir) {
    const entry = centralEntry({name: encoder.encode(name), crc, size, offset, time, date});
    dirSize += entry.length;
    parts.push(entry);
  }
  checkSize(dirStart + dirSize);
  parts.push(endOfDirectory(z.dir.length, dirSize, dirStart));
  // A later file of the export with no entry left to write (the last form ended with the file
  // before): nothing to keep.
  return {bytes: concat(...parts), rows: 0, state: {}, done: true, empty: !z.dir.length};
}

/** The central directory and end record of the entries written so far. */
function zipTrailer(z: ZipState): Uint8Array {
  const parts: Uint8Array[] = [];
  let dirSize = 0;
  for (const [name, crc, size, offset, time, date] of z.dir) {
    const entry = centralEntry({name: encoder.encode(name), crc, size, offset, time, date});
    dirSize += entry.length;
    parts.push(entry);
  }
  checkSize(z.offset + dirSize);
  parts.push(endOfDirectory(z.dir.length, dirSize, z.offset));
  return concat(...parts);
}

// ------------------------------------------------------------------ Files of one export

/**
 * A big export is several files, one per job run (job.ts: PART_ROWS rows or PART_BYTES bytes), each
 * complete on its own: a CSV part starts with the BOM and header row again; a ZIP part ends with
 * its own central directory, and a form cut at the end of a file carries on in the next one under
 * the same name (its header row again).
 *
 * `closeFile` ends the current file when the export isn't done: the bytes to append and the
 * progress for the next file. `openFile` starts the next one: the bytes it begins with (written
 * only once that file gets content of its own, so an export that ends exactly at a file's end
 * makes no empty file).
 */
export async function openFile(ctx: BuildContext, state: BuildState): Promise<{head: Uint8Array; state: BuildState}> {
  if (ctx.kind === 'responses') {
    const cat = ctx.formId ? await catalogFor(ctx, ctx.formId) : null;
    if (!cat) throw new ExportError('The form was deleted while it was being exported.');
    return {head: encoder.encode(CSV_BOM + headerRow(cat)), state};
  }
  if (ctx.kind === 'contacts') return {head: encoder.encode(contactsCsvHeader()), state};
  const z = zipState(state);
  z.dir = [];
  z.offset = 0;
  z.used = [];
  if (!z.cur) return {head: new Uint8Array(0), state: {...z}};
  // The form the last file stopped in: a new entry of the same name, from its header row.
  const {time, date} = dosDateTime(new Date());
  const head = localHeader(encoder.encode(z.cur.name), time, date);
  z.used = [z.cur.name];
  z.cur = {...z.cur, started: false, crc: 0, size: 0, start: 0, time, date};
  z.offset = head.length;
  return {head, state: {...z}};
}

export function closeFile(ctx: BuildContext, state: BuildState): {tail: Uint8Array; state: BuildState} {
  if (ctx.kind !== 'all') return {tail: new Uint8Array(0), state};
  const z = zipState(state);
  const parts: Uint8Array[] = [];
  if (z.cur) {
    // The entry so far ends here; `cur` stays, so the next file carries on with the same form.
    const cur = z.cur;
    const descriptor = dataDescriptor(cur.crc, cur.size);
    parts.push(descriptor);
    z.offset += descriptor.length;
    z.dir.push([cur.name, cur.crc, cur.size, cur.start, cur.time, cur.date]);
  }
  parts.push(zipTrailer(z));
  return {tail: concat(...parts), state: {...z, dir: [], offset: 0}};
}

/** One bounded step of an export. */
export function buildPart(ctx: BuildContext, state: BuildState): Promise<Built> {
  switch (ctx.kind) {
    case 'responses':
      return responsesStep(ctx, state);
    case 'contacts':
      return contactsStep(ctx, state);
    case 'all':
      return zipStep(ctx, state);
  }
}
