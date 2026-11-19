import type {
  DrawerAnswer,
  ResponseDetail,
  ResponseRow,
  ResponsesFilterQuery,
  ResponsesListResponse,
} from '../../../lib/intelform/api-responses';
import {RESPONSES_PAGE_SIZE} from '../../../lib/intelform/api-responses';
import type {FormDefinition} from '../../../lib/intelform/form/definition';
import {interpolate} from '../../../lib/intelform/form/logic';
import {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import {parseFieldList, type FormCatalog} from './catalog';
import {displayAnswer} from './format';
import {cursorFits, encodeCursor, isFiltered, pageQuery, safeTz, sortSpec, tableWhere, type Cursor, type PageFrom} from './query';

/** Table page and drawer data, and deletes. */

const sql = Prisma.sql;

/**
 * Filtered totals and the drawer's position are counted up to this many rows, never more (no
 * unbounded count per request). `totalCapped` says the real number is higher.
 */
export const COUNT_CAP = 1_000;

/** Most answer columns one page sends (`?col=`): the rest of a wide form's answers stay in the database. */
export const MAX_PAGE_COLUMNS = 100;

/** A page of the table: the shared shape plus the keyset cursor for the next page. */
export interface ResponsesPage extends ResponsesListResponse {
  /** Pass as `?cursor=` for the next page; null on the last page. */
  nextCursor: string | null;
  /** Pass as `?before=` for the previous page; null on the first page. */
  prevCursor: string | null;
  /** True when `total` stopped at COUNT_CAP (show "1,000+"). */
  totalCapped: boolean;
}

export type ResponseDetailView = ResponseDetail;

interface DbRow {
  id: string;
  submitted_at: Date;
  duration_ms: number | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  answers: Record<string, unknown>;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Display text per field, plus each signature's view link (the guarded
 * /site-api/uploads/signatures/:responseId/:fieldId route; only files this site stored).
 * `only`: the field ids to show (the visible columns); all fields when absent.
 */
export function rowCells(
  cat: FormCatalog,
  answers: Record<string, unknown>,
  responseId: string,
  only?: ReadonlySet<string> | null
): Pick<ResponseRow, 'cells' | 'urls'> {
  const cells: Record<string, string> = {};
  const urls: Record<string, string> = {};
  for (const e of cat.entries) {
    if (only && !only.has(e.meta.id)) continue;
    const v = answers[e.meta.id];
    if (v === undefined) continue;
    const d = displayAnswer(e.display, v, responseId);
    if (d.text) cells[e.meta.id] = d.text;
    if (d.url) urls[e.meta.id] = d.url;
  }
  return Object.keys(urls).length ? {cells, urls} : {cells};
}

/**
 * The answer field ids a page sends cells for: the requested columns that are fields of this
 * form (meta columns need no cells), at most MAX_PAGE_COLUMNS. Null = every field (no `col`).
 */
export function pageFieldIds(cat: FormCatalog, cols: readonly string[] | undefined): string[] | null {
  if (!cols?.length) return null;
  const out: string[] = [];
  for (const id of cols) {
    if (cat.byId.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_PAGE_COLUMNS) break;
  }
  return out;
}

/**
 * The answers a page reads: all of them, only the visible columns' keys (one jsonb_each per
 * row, so a 500-question response sends 30 answers, not 500), or none.
 */
export function answersSelect(ids: string[] | null): Prisma.Sql {
  if (ids === null) return sql`answers`;
  if (!ids.length) return sql`'{}'::jsonb AS answers`;
  return sql`(SELECT coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb) FROM jsonb_each(answers) a
    WHERE a.key = ANY(${ids}::text[])) AS answers`;
}

/** `count(*)` of a WHERE, stopping at COUNT_CAP + 1 rows. */
function cappedCount(where: Prisma.Sql) {
  return sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM responses WHERE ${where} LIMIT ${COUNT_CAP + 1}) t`;
}

export interface ListInput extends ResponsesFilterQuery {
  /** Rows after this position (the next page). */
  cursor: Cursor | null;
  /** Rows before this position (the previous page). Ignored when `cursor` is set. */
  before?: Cursor | null;
  /** The last page, holding this many rows. Ignored when a cursor is set. */
  last?: number | null;
  /** Rows per page (validated by the route: 25, 50 or 100). */
  size?: number;
  /** The page number the client shows (informational: paging is by cursor). */
  page: number;
  /** Visible column ids (`?col=`): cells for these fields only. Empty / absent: every field. */
  col?: string[];
}

type PageRow = DbRow & {sort_key: string | null};

/**
 * One page of the table, by keyset: rows after `cursor`, before `before`, or the last `last`
 * rows, in the current sort. One round trip (the page and, when filtered, its capped count
 * travel together). Never an offset: a page number is the client's count of pages walked.
 * `fields` (the whole catalog) travels only with a page that starts at either end (no cursor):
 * the portal keeps it while it walks the pages.
 */
export async function listResponses(db: PrismaClient, cat: FormCatalog, q: ListInput): Promise<ResponsesPage> {
  const tz = safeTz(q.tz);
  const {where, window} = tableWhere(cat, q, tz);
  const sort = sortSpec(cat, q.sort, q.dir);
  const size = Math.min(Math.max(q.size ?? RESPONSES_PAGE_SIZE, 1), 100);
  const fits = (c: Cursor | null | undefined) => (c && cursorFits(c, sort.type) ? c : null);
  const after = fits(q.cursor);
  const before = after ? null : fits(q.before);
  const last = after || before || !q.last ? null : Math.min(q.last, size);
  // Backwards (previous page, last page): read in the reverse order, then flip.
  const backwards = !!before || last !== null;
  const want = last ?? size;
  const take = want + 1;
  const ids = pageFieldIds(cat, q.col);
  const only = ids ? new Set(ids) : null;
  const cols = sql`id, submitted_at, duration_ms, device, browser, country, ${answersSelect(ids)}, (${sort.expr})::text AS sort_key`;
  const from: PageFrom = after
    ? {kind: 'after', cur: after}
    : before
      ? {kind: 'before', cur: before}
      : last !== null
        ? {kind: 'last'}
        : {kind: 'first'};
  // The catalog's exact count (form_counts) is the form total; only a filtered list needs its own (capped) count.
  const filtered = isFiltered(q);
  const formTotal = cat.form.responseCount;
  const [rows, counted] = await Promise.all([
    db.$queryRaw<PageRow[]>(pageQuery(sort, where, cols, from, take)),
    filtered ? db.$queryRaw<{n: number}[]>(cappedCount(where)).then(r => Number(r[0]?.n ?? 0)) : Promise.resolve(formTotal),
  ]);
  const more = rows.length > want;
  const page = backwards ? rows.slice(0, want).reverse() : rows.slice(0, want);
  const firstRow = page[0];
  const lastRow = page.at(-1);
  const cursorOf = (r: PageRow | undefined) => (r ? encodeCursor({k: r.sort_key, id: r.id}) : null);
  return {
    ...(!after && !before && {fields: cat.entries.map(e => e.meta)}),
    rows: page.map((r): ResponseRow => ({
      id: r.id,
      submittedAt: r.submitted_at.toISOString(),
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      device: r.device,
      browser: r.browser,
      country: r.country,
      ...rowCells(cat, asObject(r.answers), r.id, only),
    })),
    total: filtered ? Math.min(counted, COUNT_CAP) : counted,
    totalCapped: filtered && counted > COUNT_CAP,
    formTotal,
    window,
    page: q.page,
    pageSize: size,
    // Forwards: more rows past this page means a next one. Backwards: the page we came from
    // (or, for the last page, nothing) is next, and more rows mean a previous one.
    nextCursor: backwards ? (before ? cursorOf(lastRow) : null) : more ? cursorOf(lastRow) : null,
    prevCursor: backwards ? (more ? cursorOf(firstRow) : null) : after ? cursorOf(firstRow) : null,
  };
}

/**
 * The two neighbours of a row within the filter and sort: the same keyset page query as the
 * table, one row each way from the row's own sort key (so a drawer's prev / next is an index
 * walk of one row, like "load more").
 */
function neighbourQueries(db: PrismaClient, cat: FormCatalog, at: Cursor, q: ResponsesFilterQuery) {
  const tz = safeTz(q.tz);
  const {where} = tableWhere(cat, q, tz);
  const sort = sortSpec(cat, q.sort, q.dir);
  const cols = sql`id`;
  return Promise.all([
    db.$queryRaw<{id: string}[]>(pageQuery(sort, where, cols, {kind: 'after', cur: at}, 1)),
    db.$queryRaw<{id: string}[]>(pageQuery(sort, where, cols, {kind: 'before', cur: at}, 1)),
  ]);
}

/**
 * The drawer: answers with labels as they were on the response's own form version, and its
 * prev / next within the table's filter and sort. Two round trips: the row (with its sort key),
 * then the two LIMIT 1 neighbour lookups together. Of the version it reads only the fields,
 * without their descriptions (a definition can be megabytes; a label is all the drawer shows).
 */
export async function responseDetail(
  db: PrismaClient,
  cat: FormCatalog,
  rid: string,
  q: ResponsesFilterQuery
): Promise<ResponseDetailView | null> {
  type Row = DbRow & {
    started_at: Date | null;
    version: number;
    fields: unknown;
    sort_key: string | null;
  };
  const sort = sortSpec(cat, q.sort, q.dir);
  const rows = await db.$queryRaw<Row[]>`
    SELECT r.id, r.submitted_at, r.started_at, r.duration_ms, r.device, r.browser, r.country, r.answers,
      (${sort.expr})::text AS sort_key, v.version,
      (SELECT jsonb_agg(f - 'description' - 'descriptionFormat' ORDER BY n)
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.definition->'fields') = 'array' THEN v.definition->'fields' ELSE '[]'::jsonb END)
         WITH ORDINALITY AS e(f, n)
       WHERE f->>'type' IS DISTINCT FROM 'section_break') AS fields
    FROM responses r JOIN form_versions v ON v.id = r.form_version_id
    WHERE r.id = ${rid}::uuid AND r.form_id = ${cat.form.id}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  const [[next], [prev]] = await neighbourQueries(db, cat, {k: row.sort_key, id: row.id}, q);
  const answersObj = asObject(row.answers);
  const fields = parseFieldList(row.fields);
  const def = {fields} as Pick<FormDefinition, 'fields'>;
  const answers: DrawerAnswer[] = fields.map(f => {
    // Labels as submitted, with options as they were on that version.
    const d = displayAnswer(f, answersObj[f.id], row.id);
    const label = interpolate(f.label, def, answersObj).trim() || 'Untitled question';
    return {
      fieldId: f.id,
      type: f.type,
      label,
      text: d.text,
      ...(d.url && {url: d.url}),
      ...(d.html && {html: d.html}),
    };
  });
  return {
    id: row.id,
    formVersion: Number(row.version),
    submittedAt: row.submitted_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    device: row.device,
    browser: row.browser,
    country: row.country,
    answers,
    prevId: prev?.id ?? null,
    nextId: next?.id ?? null,
  };
}

export interface DeleteResult {
  /** False when the form itself is gone. */
  formFound: boolean;
  deleted: number;
}

/**
 * Deletes responses of one form in ONE statement. The responses delete trigger takes them off
 * the form's counters (form_counts, form_response_hours) and contacts, and puts their signature
 * files in the file trash; the caller sends the cleanup job (uploads/trash.ts). The forms row is
 * neither locked nor written: forms.response_count / last_response_at are a copy the
 * every-minute syncFormCounts refreshes (src/server/intelform/forms/counts.ts), and every place
 * that shows the count right after a delete reads the exact sum instead.
 */
export async function deleteResponses(db: PrismaClient, formId: string, ids: readonly string[]): Promise<DeleteResult> {
  if (!ids.length) return {formFound: true, deleted: 0};
  const rows = await db.$queryRaw<{form_found: number; deleted: number}[]>`
    WITH f AS (SELECT id FROM forms WHERE id = ${formId}::uuid),
    d AS (
      DELETE FROM responses r USING f WHERE r.form_id = f.id AND r.id = ANY(${[...ids]}::uuid[])
      RETURNING r.id
    )
    SELECT (SELECT count(*) FROM f)::int AS form_found,
      (SELECT count(*) FROM d)::int AS deleted
  `;
  const r = rows[0];
  return {formFound: Number(r?.form_found ?? 0) > 0, deleted: Number(r?.deleted ?? 0)};
}
