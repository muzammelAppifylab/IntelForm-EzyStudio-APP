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
import {displayAnswer, fileIdFromUrl} from './format';
import {
  cursorCte,
  cursorFits,
  encodeCursor,
  isFiltered,
  keysetFragments,
  orderFragment,
  reverseOrderFragment,
  safeTz,
  sortSpec,
  whereFragment,
  type Cursor,
} from './query';

/** Table page and drawer data, and deletes. */

const sql = Prisma.sql;

/**
 * Filtered totals and the drawer's position are counted up to this many rows, never more (no
 * unbounded count per request). `totalCapped` says the real number is higher.
 */
export const COUNT_CAP = 10_000;

/** A page of the table: the shared shape plus the keyset cursor for the next page. */
export interface ResponsesPage extends ResponsesListResponse {
  /** Pass as `?cursor=` for the next page; null on the last page. */
  nextCursor: string | null;
  /** True when `total` stopped at COUNT_CAP (show "10,000+"). */
  totalCapped: boolean;
}

export interface ResponseDetailView extends ResponseDetail {
  /** True when `position` / `total` stopped at COUNT_CAP. */
  totalCapped: boolean;
}

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

/** Display text per field, plus the signature image URLs (only files this site stored). */
export function rowCells(cat: FormCatalog, answers: Record<string, unknown>): Pick<ResponseRow, 'cells' | 'urls'> {
  const cells: Record<string, string> = {};
  const urls: Record<string, string> = {};
  for (const e of cat.entries) {
    const v = answers[e.meta.id];
    if (v === undefined) continue;
    const d = displayAnswer(e.display, v);
    if (d.text) cells[e.meta.id] = d.text;
    if (d.url) urls[e.meta.id] = d.url;
  }
  return Object.keys(urls).length ? {cells, urls} : {cells};
}

/** `count(*)` of a WHERE, stopping at COUNT_CAP + 1 rows. */
function cappedCount(where: Prisma.Sql, withCur: Prisma.Sql | null) {
  return withCur
    ? sql`WITH ${withCur} SELECT count(*)::int AS n FROM (SELECT 1 FROM responses, cur WHERE ${where} LIMIT ${COUNT_CAP + 1}) t`
    : sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM responses WHERE ${where} LIMIT ${COUNT_CAP + 1}) t`;
}

export interface ListInput extends ResponsesFilterQuery {
  cursor: Cursor | null;
  /** The page number the client shows (informational: paging is by cursor). */
  page: number;
}

/**
 * One page of the table, by keyset: rows after `cursor` in the current sort. One round trip
 * (the page and, when filtered, its capped count travel together).
 */
export async function listResponses(db: PrismaClient, cat: FormCatalog, q: ListInput): Promise<ResponsesPage> {
  const tz = safeTz(q.tz);
  const where = whereFragment(cat, q, tz);
  const sort = sortSpec(cat, q.sort, q.dir);
  const cursor = q.cursor && cursorFits(q.cursor, sort.type) ? q.cursor : null;
  const take = RESPONSES_PAGE_SIZE + 1;
  const pageSql = cursor
    ? sql`WITH ${cursorCte(cursor, sort.type)}
        SELECT id, submitted_at, duration_ms, device, browser, country, answers, (${sort.expr})::text AS sort_key
        FROM responses, cur WHERE ${where} AND ${keysetFragments(sort).after}
        ORDER BY ${orderFragment(sort)} LIMIT ${take}`
    : sql`SELECT id, submitted_at, duration_ms, device, browser, country, answers, (${sort.expr})::text AS sort_key
        FROM responses WHERE ${where} ORDER BY ${orderFragment(sort)} LIMIT ${take}`;
  // forms.response_count is the form total; only a filtered list needs its own (capped) count.
  const filtered = isFiltered(q);
  const formTotal = cat.form.responseCount;
  const [rows, counted] = await Promise.all([
    db.$queryRaw<(DbRow & {sort_key: string | null})[]>(pageSql),
    filtered ? db.$queryRaw<{n: number}[]>(cappedCount(where, null)).then(r => Number(r[0]?.n ?? 0)) : Promise.resolve(formTotal),
  ]);
  const page = rows.slice(0, RESPONSES_PAGE_SIZE);
  const last = page.at(-1);
  return {
    fields: cat.entries.map(e => e.meta),
    rows: page.map((r): ResponseRow => ({
      id: r.id,
      submittedAt: r.submitted_at.toISOString(),
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      device: r.device,
      browser: r.browser,
      country: r.country,
      ...rowCells(cat, asObject(r.answers)),
    })),
    total: filtered ? Math.min(counted, COUNT_CAP) : counted,
    totalCapped: filtered && counted > COUNT_CAP,
    formTotal,
    page: q.page,
    pageSize: RESPONSES_PAGE_SIZE,
    nextCursor: rows.length > RESPONSES_PAGE_SIZE && last ? encodeCursor({k: last.sort_key, id: last.id}) : null,
  };
}

/** Neighbour and count queries of `rid` within the filter and sort (keyset), all reads. */
function neighbourQueries(db: PrismaClient, cat: FormCatalog, rid: string, q: ResponsesFilterQuery) {
  const tz = safeTz(q.tz);
  const where = whereFragment(cat, q, tz);
  const sort = sortSpec(cat, q.sort, q.dir);
  const {after, before} = keysetFragments(sort);
  const cur = sql`cur AS (SELECT ${sort.expr} AS k, id AS kid FROM responses WHERE id = ${rid}::uuid AND form_id = ${cat.form.id}::uuid)`;
  const filtered = isFiltered(q);
  return Promise.all([
    db.$queryRaw<
      {id: string}[]
    >`WITH ${cur} SELECT id FROM responses, cur WHERE ${where} AND ${after} ORDER BY ${orderFragment(sort)} LIMIT 1`,
    db.$queryRaw<
      {id: string}[]
    >`WITH ${cur} SELECT id FROM responses, cur WHERE ${where} AND ${before} ORDER BY ${reverseOrderFragment(sort)} LIMIT 1`,
    db.$queryRaw<{n: number}[]>(cappedCount(sql`${where} AND ${before}`, cur)),
    filtered ? db.$queryRaw<{n: number}[]>(cappedCount(where, null)) : Promise.resolve([{n: cat.form.responseCount}]),
  ]);
}

/**
 * The drawer: answers with labels as they were on the response's own form version, and its
 * prev / next within the table's filter and sort. One round trip (all reads together).
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
    definition: FormDefinition;
  };
  const [rows, [[next], [prev], [before], [total]]] = await Promise.all([
    db.$queryRaw<Row[]>`
      SELECT r.id, r.submitted_at, r.started_at, r.duration_ms, r.device, r.browser, r.country, r.answers, v.version, v.definition
      FROM responses r JOIN form_versions v ON v.id = r.form_version_id
      WHERE r.id = ${rid}::uuid AND r.form_id = ${cat.form.id}::uuid
    `,
    neighbourQueries(db, cat, rid, q),
  ]);
  const row = rows[0];
  if (!row) return null;
  const answersObj = asObject(row.answers);
  const fields = parseFieldList(row.definition?.fields);
  const def = {...row.definition, fields} as FormDefinition;
  const answers: DrawerAnswer[] = fields.map(f => {
    // Labels as submitted, with options as they were on that version.
    const d = displayAnswer(f, answersObj[f.id]);
    const label = interpolate(f.label, def, answersObj).trim() || 'Untitled question';
    return {
      fieldId: f.id,
      type: f.type,
      label,
      text: d.text,
      ...(d.url && {url: d.url}),
    };
  });
  const beforeN = Number(before?.n ?? 0);
  const totalN = Number(total?.n ?? 0);
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
    position: Math.min(beforeN, COUNT_CAP) + 1,
    total: Math.min(totalN, COUNT_CAP),
    totalCapped: beforeN > COUNT_CAP || totalN > COUNT_CAP,
  };
}

export interface DeleteResult {
  /** False when the form itself is gone. */
  formFound: boolean;
  deleted: number;
  /** Platform file ids of the deleted responses' stored files (signatures), to remove after. */
  fileIds: string[];
}

/**
 * Deletes responses of one form and keeps forms.response_count / last_response_at in step, in
 * ONE statement (atomic, no interactive transaction): the form row is locked first so deletes
 * and submits serialise on the counter. The ids of stored files in the deleted answers come
 * back for the caller to remove after the write: only answers of signature questions, whose
 * URLs the submit route wrote itself (a respondent sends the drawing, never a URL), so a
 * response can never point a delete at another file of the site.
 */
export async function deleteResponses(
  db: PrismaClient,
  formId: string,
  ids: readonly string[],
  signatureFieldIds: readonly string[]
): Promise<DeleteResult> {
  if (!ids.length) return {formFound: true, deleted: 0, fileIds: []};
  const rows = await db.$queryRaw<{form_found: number; deleted: number; urls: string[] | null}[]>`
    WITH f AS (SELECT id FROM forms WHERE id = ${formId}::uuid FOR UPDATE),
    d AS (
      DELETE FROM responses r USING f WHERE r.form_id = f.id AND r.id = ANY(${[...ids]}::uuid[])
      RETURNING r.id, ARRAY(
        SELECT e.v->>'url' FROM jsonb_each(r.answers) e(k, v)
        WHERE e.k = ANY(${[...signatureFieldIds, '']}::text[])
          AND jsonb_typeof(e.v) = 'object' AND starts_with(e.v->>'url', '/__platform/files/')
      ) AS urls
    ),
    u AS (
      UPDATE forms SET
        response_count = GREATEST(0, response_count - (SELECT count(*) FROM d)),
        last_response_at = (
          SELECT max(submitted_at) FROM responses
          WHERE form_id = ${formId}::uuid AND id NOT IN (SELECT id FROM d)
        )
      WHERE id = (SELECT id FROM f) AND EXISTS (SELECT 1 FROM d)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM f)::int AS form_found,
      (SELECT count(*) FROM d)::int AS deleted,
      (SELECT coalesce(array_agg(x), '{}') FROM d, unnest(d.urls) x) AS urls,
      (SELECT count(*) FROM u)::int AS updated
  `;
  const r = rows[0];
  const fileIds = [...new Set((r?.urls ?? []).map(fileIdFromUrl).filter((x): x is string => !!x))];
  return {
    formFound: Number(r?.form_found ?? 0) > 0,
    deleted: Number(r?.deleted ?? 0),
    fileIds,
  };
}
