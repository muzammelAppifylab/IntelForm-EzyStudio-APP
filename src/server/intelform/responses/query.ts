import type {ResponsesFilterQuery} from '../../../lib/intelform/api-responses';
import {COUNTRY_CODES, countryName} from '../../../lib/intelform/form/types/registry';
import {Prisma} from '../../../generated/prisma/client';
import {fromBase64Url, fromUtf8, toBase64Url, utf8} from '../../../platform/auth/encoding';
import type {FormCatalog} from './catalog';

/**
 * SQL pieces shared by the table, the drawer's prev / next and the CSV export: the WHERE
 * clause for the filters, the registry-driven sort expression and keyset conditions. All of
 * it is tagged `Prisma.sql` (bound parameters); column expressions come from fixed maps only.
 */

type Sql = Prisma.Sql;
const sql = Prisma.sql;

// ------------------------------------------------------------------ Time zones

let zones: Set<string> | null = null;

/**
 * A time zone both Postgres and Intl know; UTC otherwise. Checked against the runtime's IANA
 * list (no database round trip); Postgres ships the same tz database.
 */
export function safeTz(tz: string | undefined): string {
  if (!tz || tz.length > 64) return 'UTC';
  if (!zones) {
    try {
      zones = new Set(Intl.supportedValuesOf('timeZone'));
    } catch {
      zones = new Set();
    }
    zones.add('UTC');
  }
  return zones.has(tz) ? tz : 'UTC';
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** submitted_at within local dates [from, to] in tz (DST-safe). */
export function rangeFragment(from: string | undefined, to: string | undefined, tz: string): Sql {
  const parts: Sql[] = [];
  if (from) parts.push(sql`submitted_at >= (${from}::date::timestamp AT TIME ZONE ${tz})`);
  if (to) parts.push(sql`submitted_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`);
  return and(parts);
}

export function and(parts: Sql[]): Sql {
  if (!parts.length) return sql`true`;
  return Prisma.join(parts, ' AND ');
}

function or(parts: Sql[]): Sql {
  if (!parts.length) return sql`false`;
  return Prisma.join(parts, ' OR ');
}

// ------------------------------------------------------------------ Filters

/** A choice filter value as the jsonb that `answers @>` must contain. */
export function containment(cat: FormCatalog, fieldId: string, value: string): object | null {
  const entry = cat.byId.get(fieldId);
  if (!entry) return null;
  switch (entry.meta.type) {
    case 'single_choice':
    case 'dropdown':
      return {[fieldId]: {option: value}};
    case 'multiple_choice':
    case 'picture_choice':
      return {[fieldId]: [{option: value}]};
    case 'yes_no':
      return value === 'true' || value === 'false' ? {[fieldId]: value === 'true'} : null;
    case 'country':
      return /^[A-Z]{2}$/.test(value) ? {[fieldId]: value} : null;
    case 'rating':
    case 'nps':
      return /^\d{1,2}$/.test(value) ? {[fieldId]: Number(value)} : null;
    default:
      return null;
  }
}

/** `%term%` for ILIKE, with the pattern characters escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/** True when any table filter is set (the form total no longer answers "how many"). */
export function isFiltered(q: ResponsesFilterQuery): boolean {
  return !!(q.from || q.to || q.q || q.has || q.filter.length);
}

/** WHERE for one form and the table filters (columns unprefixed: callers alias nothing). */
export function whereFragment(cat: FormCatalog, q: ResponsesFilterQuery, tz: string): Sql {
  const parts: Sql[] = [sql`form_id = ${cat.form.id}::uuid`];
  if (q.from || q.to) parts.push(rangeFragment(q.from, q.to, tz));
  if (q.q) parts.push(sql`search_text ILIKE ${likePattern(q.q)}`);
  if (q.has) parts.push(sql`answers ? ${q.has}`);
  const byField = new Map<string, object[]>();
  for (const f of q.filter) {
    const i = f.indexOf(':');
    const fieldId = f.slice(0, i);
    const json = containment(cat, fieldId, f.slice(i + 1));
    if (json) byField.set(fieldId, [...(byField.get(fieldId) ?? []), json]);
  }
  for (const list of byField.values()) {
    parts.push(sql`(${or(list.map(j => sql`answers @> ${JSON.stringify(j)}::jsonb`))})`);
  }
  return and(parts);
}

// ------------------------------------------------------------------ Scan window

/**
 * "Has an answer" (`answers ? f`) and search (`search_text ILIKE`) have no per-form index (no GIN
 * on responses: every submit would pay for it), so on a big form a filter few rows match would
 * read the whole form for one page and its count. They look at the newest SEARCH_WINDOW
 * responses only, read through the (form_id, submitted_at DESC, id DESC) index.
 */
export const SEARCH_WINDOW = 100_000;
/**
 * Sorting by an answer computes the key from the answers jsonb of every row it sorts: on a form
 * with more responses than this it sorts the newest ANSWER_SORT_WINDOW only (the table says so).
 */
export const ANSWER_SORT_WINDOW = 50_000;
/** Shortest search term: a trigram needs three characters, and shorter ones match nearly every row. */
export const MIN_SEARCH_LENGTH = 3;

export interface ScanWindow {
  /** Only the newest `size` responses of the form were searched or sorted. */
  size: number;
  reason: 'search' | 'sort';
}

/** True for a column whose sort key comes from the answers (not submitted_at or a metadata column). */
export function isAnswerSort(cat: FormCatalog, column: string): boolean {
  return cat.byId.has(column) && !(column in META_SORT) && column !== 'submitted_at';
}

/**
 * The window this query reads within, or null when the whole form is cheap enough: the form
 * holds more responses than the window (the exact form total, form_counts) and a has / search
 * filter or an answer sort is on. The smaller window wins.
 */
export function scanWindow(cat: FormCatalog, q: Pick<ResponsesFilterQuery, 'q' | 'has' | 'sort'>): ScanWindow | null {
  const total = cat.form.responseCount;
  let w: ScanWindow | null = null;
  if ((q.q || q.has) && total > SEARCH_WINDOW) w = {size: SEARCH_WINDOW, reason: 'search'};
  if (isAnswerSort(cat, q.sort) && total > ANSWER_SORT_WINDOW) w = {size: ANSWER_SORT_WINDOW, reason: 'sort'};
  return w;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Rows at or after the form's `size`-th newest response, as a row comparison the
 * (form_id, submitted_at DESC, id DESC) index takes as its range. The boundary is one
 * index-only walk of `size` entries (an uncorrelated sub-select: run once per statement).
 * No boundary (rows deleted meanwhile): every row.
 */
export function windowFragment(formId: string, size: number): Sql {
  return sql`(submitted_at, id) >= (SELECT coalesce(b.s, '-infinity'::timestamptz), coalesce(b.i, ${NIL_UUID}::uuid)
    FROM (SELECT 1) one LEFT JOIN (SELECT submitted_at AS s, id AS i FROM responses
      WHERE form_id = ${formId}::uuid ORDER BY submitted_at DESC, id DESC OFFSET ${size - 1} LIMIT 1) b ON true)`;
}

/** The table's and the drawer's WHERE: the filters, within the scan window when one applies. */
export function tableWhere(cat: FormCatalog, q: ResponsesFilterQuery, tz: string): {where: Sql; window: ScanWindow | null} {
  const window = scanWindow(cat, q);
  const where = whereFragment(cat, q, tz);
  return {where: window ? sql`${where} AND ${windowFragment(cat.form.id, window.size)}` : where, window};
}

// ------------------------------------------------------------------ Sorting

/** The SQL type of a sort key, so a keyset cursor (sent as text) is cast back exactly. */
export type KeyType = 'timestamptz' | 'int' | 'numeric' | 'text' | 'boolean';

let countryOrder: string[] | null = null;

const META_SORT: Record<string, {expr: Sql; type: KeyType}> = {
  duration: {expr: sql`duration_ms`, type: 'int'},
  device: {expr: sql`device`, type: 'text'},
  browser: {expr: sql`browser`, type: 'text'},
  country: {expr: sql`country`, type: 'text'},
};

/**
 * The sort key for a column, NULL when unanswered (always sorted last). Choices sort by option
 * label via array_position over ids pre-sorted by label; numbers numerically; ISO dates and
 * times as text. Unknown columns sort by submitted_at.
 */
export function sortExpression(cat: FormCatalog, column: string): {expr: Sql; type: KeyType} {
  if (column === 'submitted_at') return {expr: sql`submitted_at`, type: 'timestamptz'};
  const meta = META_SORT[column];
  if (meta) return meta;
  const entry = cat.byId.get(column);
  if (!entry) return {expr: sql`submitted_at`, type: 'timestamptz'};
  const f = column;
  const byLabel = () =>
    (entry.meta.options ?? [])
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, 'en', {sensitivity: 'base'}))
      .map(o => o.id);
  switch (entry.meta.type) {
    case 'number':
    case 'rating':
    case 'nps':
      return {
        expr: sql`(CASE WHEN jsonb_typeof(answers->${f}) = 'number' THEN (answers->>${f})::numeric END)`,
        type: 'numeric',
      };
    case 'single_choice':
    case 'dropdown':
      return {
        expr: sql`array_position(${byLabel()}::text[], answers->${f}->>'option')`,
        type: 'int',
      };
    case 'multiple_choice':
    case 'picture_choice':
      return {
        expr: sql`array_position(${byLabel()}::text[], answers->${f}->0->>'option')`,
        type: 'int',
      };
    case 'yes_no':
      return {
        expr: sql`(CASE WHEN jsonb_typeof(answers->${f}) = 'boolean' THEN (answers->>${f})::boolean END)`,
        type: 'boolean',
      };
    case 'country':
      countryOrder ??= COUNTRY_CODES.slice().sort((a, b) => countryName(a).localeCompare(countryName(b)));
      return {
        expr: sql`array_position(${countryOrder}::text[], answers->>${f})`,
        type: 'int',
      };
    case 'name':
      return {
        expr: sql`lower(CASE jsonb_typeof(answers->${f}) WHEN 'string' THEN answers->>${f}
          WHEN 'object' THEN concat_ws(' ', answers->${f}->>'first', answers->${f}->>'last') END)`,
        type: 'text',
      };
    case 'address':
      return {
        expr: sql`lower(coalesce(answers->${f}->>'street', answers->${f}->>'city', answers->${f}->>'country'))`,
        type: 'text',
      };
    case 'consent':
      return {expr: sql`(answers->${f}->>'accepted')`, type: 'text'};
    case 'signature':
      return {expr: sql`(CASE WHEN answers ? ${f} THEN 1 END)`, type: 'int'};
    case 'date':
    case 'time':
      return {expr: sql`(answers->>${f})`, type: 'text'};
    default:
      return {expr: sql`lower(answers->>${f})`, type: 'text'};
  }
}

export interface SortSpec {
  expr: Sql;
  type: KeyType;
  dir: 'asc' | 'desc';
  /** Tie-breaker direction on id. */
  tie: 'asc' | 'desc';
  /** submitted_at is NOT NULL: plain ORDER BY so the (form_id, submitted_at DESC, id DESC) index serves it. */
  notNull: boolean;
  /**
   * A nullable column with its own (form_id, column, id) index (duration, device, browser,
   * country): paged in two parts, answered rows then unanswered ones, each an index walk.
   */
  indexed: boolean;
}

export function sortSpec(cat: FormCatalog, column: string, dir: 'asc' | 'desc'): SortSpec {
  const {expr, type} = sortExpression(cat, column);
  const indexed = column in META_SORT;
  const notNull = column === 'submitted_at' || (!cat.byId.has(column) && !indexed);
  // Index-served sorts run the tie-breaker the same way as the key, so one index walk (forwards
  // or backwards) gives the whole order. Answer sorts keep id DESC.
  return {
    expr,
    type,
    dir,
    tie: (notNull || indexed) && dir === 'asc' ? 'asc' : 'desc',
    notNull,
    indexed,
  };
}

const D = (d: 'asc' | 'desc') => (d === 'asc' ? sql`ASC` : sql`DESC`);
const flip = (d: 'asc' | 'desc') => (d === 'asc' ? 'desc' : 'asc');

/** ORDER BY: the key (unanswered last both ways), then id. */
export function orderFragment(s: SortSpec): Sql {
  if (s.notNull) return sql`${s.expr} ${D(s.dir)}, id ${D(s.tie)}`;
  return sql`${s.expr} ${D(s.dir)} NULLS LAST, id ${D(s.tie)}`;
}

/** The reverse order (for "previous" lookups): NULLs first, every direction flipped. */
export function reverseOrderFragment(s: SortSpec): Sql {
  if (s.notNull) return sql`${s.expr} ${D(flip(s.dir))}, id ${D(flip(s.tie))}`;
  return sql`${s.expr} ${D(flip(s.dir))} NULLS FIRST, id ${D(flip(s.tie))}`;
}

/**
 * Keyset conditions relative to a current row whose key is `cur.k` and id `cur.kid` (a CTE the
 * caller cross-joins). "after" = later in the table order, "before" = earlier.
 */
export function keysetFragments(s: SortSpec): {after: Sql; before: Sql} {
  const lt = (a: Sql, b: Sql) => sql`${a} < ${b}`;
  const gt = (a: Sql, b: Sql) => sql`${a} > ${b}`;
  const eAfter = s.dir === 'desc' ? lt : gt;
  const eBefore = s.dir === 'desc' ? gt : lt;
  const idAfter = s.tie === 'desc' ? sql`id < cur.kid` : sql`id > cur.kid`;
  const idBefore = s.tie === 'desc' ? sql`id > cur.kid` : sql`id < cur.kid`;
  const e = s.expr;
  const k = sql`cur.k`;
  if (s.notNull) {
    // A row comparison, not "a < k OR (a = k AND id < kid)": Postgres uses it as an index
    // condition, so "load more" and the drawer's prev / next start AT the cursor instead of
    // walking the form from its first row (index: form_id, submitted_at DESC, id DESC).
    // Valid because a not-null key's tie-breaker always runs the same way as the key.
    const row = sql`(${e}, id)`;
    const at = sql`(cur.k, cur.kid)`;
    return {after: sql`${eAfter(row, at)}`, before: sql`${eBefore(row, at)}`};
  }
  return {
    after: sql`(CASE WHEN cur.k IS NULL THEN ${e} IS NULL AND ${idAfter}
      ELSE ${eAfter(e, k)} OR (${e} = cur.k AND ${idAfter}) OR ${e} IS NULL END)`,
    before: sql`(CASE WHEN cur.k IS NULL THEN ${e} IS NOT NULL OR ${idBefore}
      ELSE ${eBefore(e, k)} OR (${e} = cur.k AND ${idBefore}) END)`,
  };
}

// ------------------------------------------------------------------ Page queries

/** Where a page starts: the top, after / before a cursor, or the end (read backwards). */
export type PageFrom = {kind: 'first'} | {kind: 'after'; cur: Cursor} | {kind: 'before'; cur: Cursor} | {kind: 'last'};

/**
 * One page of rows (`take` of them) in the sort order, or in reverse order for `before` and
 * `last` (the caller flips them). `cols` is the select list; `where` the filters.
 *
 * - submitted_at: one row comparison against the cursor, served by its index.
 * - duration / device / browser / country (nullable, indexed): answered rows then unanswered
 *   ones (NULLS LAST both ways), two LIMITed index walks joined by UNION ALL. A cursor's key
 *   is known here, so only the part(s) still ahead of it run, each with a row comparison.
 * - an answer: the CASE / OR keyset (no index fits a jsonb expression; bounded by the window).
 */
export function pageQuery(s: SortSpec, where: Sql, cols: Sql, from: PageFrom, take: number): Sql {
  const backwards = from.kind === 'before' || from.kind === 'last';
  const cur = from.kind === 'after' || from.kind === 'before' ? from.cur : null;
  if (!s.indexed) {
    const order = backwards ? reverseOrderFragment(s) : orderFragment(s);
    if (!cur) return sql`SELECT ${cols} FROM responses WHERE ${where} ORDER BY ${order} LIMIT ${take}`;
    const k = keysetFragments(s);
    return sql`WITH ${cursorCte(cur, s.type)} SELECT ${cols} FROM responses, cur
      WHERE ${where} AND ${backwards ? k.before : k.after} ORDER BY ${order} LIMIT ${take}`;
  }
  // Reading direction: the sort's own, or flipped when reading backwards.
  const dir = backwards ? flip(s.dir) : s.dir;
  const tie = backwards ? flip(s.tie) : s.tie;
  const cmp = dir === 'desc' ? sql`<` : sql`>`;
  const e = s.expr;
  const answered = (afterCur: boolean) =>
    afterCur
      ? sql`SELECT 0 AS ph, ${e} AS sk, ${cols} FROM responses, cur WHERE ${where} AND ${e} IS NOT NULL
          AND (${e}, id) ${cmp} (cur.k, cur.kid) ORDER BY ${e} ${D(dir)}, id ${D(tie)} LIMIT ${take}`
      : sql`SELECT 0 AS ph, ${e} AS sk, ${cols} FROM responses WHERE ${where} AND ${e} IS NOT NULL
          ORDER BY ${e} ${D(dir)}, id ${D(tie)} LIMIT ${take}`;
  // All keys here are NULL, so ordering by the key too changes nothing but matches the
  // (form_id, column, id) index exactly: the planner walks it instead of the primary key.
  const unanswered = (afterCur: boolean) =>
    afterCur
      ? sql`SELECT 1 AS ph, ${e} AS sk, ${cols} FROM responses, cur WHERE ${where} AND ${e} IS NULL
          AND id ${tie === 'desc' ? sql`<` : sql`>`} cur.kid ORDER BY ${e} ${D(dir)}, id ${D(tie)} LIMIT ${take}`
      : sql`SELECT 1 AS ph, ${e} AS sk, ${cols} FROM responses WHERE ${where} AND ${e} IS NULL
          ORDER BY ${e} ${D(dir)}, id ${D(tie)} LIMIT ${take}`;
  // Forwards: answered (from the cursor) then unanswered. Backwards: unanswered then answered.
  let parts: Sql[];
  if (!backwards) {
    if (!cur) parts = [answered(false), unanswered(false)];
    else if (cur.k !== null) parts = [answered(true), unanswered(false)];
    else parts = [unanswered(true)];
  } else {
    if (!cur) parts = [unanswered(false), answered(false)];
    else if (cur.k !== null) parts = [answered(true)];
    else parts = [unanswered(true), answered(false)];
  }
  const head = cur ? sql`WITH ${cursorCte(cur, s.type)} ` : sql``;
  // Phase order: answered (0) first forwards, unanswered (1) first backwards.
  const phase = backwards ? sql`ph DESC` : sql`ph ASC`;
  return sql`${head}SELECT * FROM (${Prisma.join(
    parts.map(p => sql`(${p})`),
    ' UNION ALL '
  )}) page ORDER BY ${phase}, sk ${D(dir)}, id ${D(tie)} LIMIT ${take}`;
}

// ------------------------------------------------------------------ Keyset cursor

/** The position after the last row of a page: its sort key as text (null = unanswered) and its id. */
export interface Cursor {
  k: string | null;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: Cursor): string {
  return toBase64Url(utf8(JSON.stringify([c.k, c.id])));
}

/** A cursor from the query string; null when it is not one this server wrote. */
export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw || raw.length > 1000) return null;
  try {
    const bytes = fromBase64Url(raw);
    if (!bytes) return null;
    const v: unknown = JSON.parse(fromUtf8(bytes));
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [k, id] = v as [unknown, unknown];
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    if (k !== null && (typeof k !== 'string' || k.length > 600)) return null;
    return {k, id};
  } catch {
    return null;
  }
}

/** `cur(k, kid)` from a cursor, the key cast back to the sort key's own type (fixed map). */
export function cursorCte(c: Cursor, type: KeyType): Sql {
  const k = c.k;
  let key: Sql;
  switch (type) {
    case 'timestamptz':
      key = sql`${k}::timestamptz`;
      break;
    case 'int':
      key = sql`${k}::int`;
      break;
    case 'numeric':
      key = sql`${k}::numeric`;
      break;
    case 'boolean':
      key = sql`${k}::boolean`;
      break;
    default:
      key = sql`${k}::text`;
  }
  return sql`cur AS (SELECT ${key} AS k, ${c.id}::uuid AS kid)`;
}

/** A cursor's key must parse as its column's type, or the cast fails in SQL (500): check first. */
export function cursorFits(c: Cursor, type: KeyType): boolean {
  if (c.k === null) return true;
  switch (type) {
    case 'timestamptz':
      return !Number.isNaN(Date.parse(c.k.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')));
    case 'int':
      return /^-?\d{1,10}$/.test(c.k);
    case 'numeric':
      return /^-?\d{1,40}(\.\d{1,40})?$/.test(c.k);
    case 'boolean':
      return c.k === 'true' || c.k === 'false';
    default:
      return true;
  }
}
