import {Prisma} from '../../../generated/prisma/client';
import type {ContactSort, ContactsFilterQuery} from '../../../lib/intelform/api-contacts';

/**
 * SQL pieces for the contacts queries (pure: no database here, so they are unit-tested).
 * Every piece is a tagged `Prisma.sql` (values are bound parameters); identifiers and sort
 * expressions come only from the fixed maps below (docs/agent/security.md A05).
 *
 * Contacts are responses grouped by `responses.contact_key` ("e:<email>" or "p:<phone>"). The
 * `contacts` table holds one row per key (count, first / last seen, latest details, forms),
 * kept by triggers on `responses` in the same statement as every insert and delete (the
 * review-fixes migration). Lists, filters, the strip and the CSV read that table, aliased `c`,
 * with an index per sort and keyset paging: never an aggregate over responses per request.
 */

type Sql = Prisma.Sql;

export function and(parts: Sql[]): Sql {
  if (!parts.length) return Prisma.sql`true`;
  return parts.reduce((a, p) => Prisma.sql`${a} AND ${p}`);
}

export function or(parts: Sql[]): Sql {
  if (!parts.length) return Prisma.sql`false`;
  return parts.reduce((a, p) => Prisma.sql`${a} OR ${p}`);
}

/** `%term%` for ILIKE, with the pattern characters escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

/** The columns a contacts row is read with (from `contacts c`). */
export const CONTACT_COLUMNS = Prisma.sql`c.key, c.n, c.first_seen, c.last_seen, c.email, c.name, c.phone, c.country, c.form_count`;

/** Same expression as the contacts_search_trgm index (the review-fixes migration). */
const SEARCH_EXPR = Prisma.sql`(coalesce(c.name, '') || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.phone, ''))`;

/** `col` within local dates [from, to] in tz, inclusive, DST-safe. */
export function dayRange(col: Sql, from: string | undefined, to: string | undefined, tz: string): Sql[] {
  const parts: Sql[] = [];
  if (from) parts.push(Prisma.sql`${col} >= (${from}::date::timestamp AT TIME ZONE ${tz})`);
  if (to) parts.push(Prisma.sql`${col} < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`);
  return parts;
}

/** The search patterns for `q`: as typed, plus without phone punctuation ("+44 20 7946"). */
export function searchPatterns(q: string): string[] {
  const patterns = [likePattern(q)];
  const compact = q.replace(/[\s().-]/g, '');
  if (compact !== q && compact.length >= 3) patterns.push(likePattern(compact));
  return patterns;
}

/** WHERE on `contacts c` for the list and CSV filters. */
export function filterFragment(q: ContactsFilterQuery, tz: string): Sql {
  const parts: Sql[] = [];
  if (q.q) {
    const match = or(searchPatterns(q.q).map(p => Prisma.sql`${SEARCH_EXPR} ILIKE ${p}`));
    parts.push(Prisma.sql`(${match})`);
  }
  if (q.segment === 'returning') parts.push(Prisma.sql`c.n >= 2`);
  if (q.segment === 'new') {
    const range = dayRange(Prisma.sql`c.first_seen`, q.from, q.to, tz);
    parts.push(range.length ? and(range) : Prisma.sql`c.first_seen >= now() - interval '7 days'`);
  }
  if (q.form.length) parts.push(Prisma.sql`c.form_ids && ${q.form}::uuid[]`);
  if (q.country.length) parts.push(Prisma.sql`c.country = ANY(${q.country}::text[])`);
  for (const h of new Set(q.has)) {
    if (h === 'email') parts.push(Prisma.sql`c.email IS NOT NULL`);
    else if (h === 'phone') parts.push(Prisma.sql`c.phone IS NOT NULL`);
    else parts.push(Prisma.sql`c.name IS NOT NULL`);
  }
  parts.push(...dayRange(Prisma.sql`c.last_seen`, q.from, q.to, tz));
  if (q.min !== undefined) parts.push(Prisma.sql`c.n >= ${q.min}`);
  if (q.max !== undefined) parts.push(Prisma.sql`c.n <= ${q.max}`);
  return and(parts);
}

interface SortSpec {
  expr: Sql;
  /** The SQL type a cursor value is cast back to. */
  cast: Sql;
  /** Can be NULL: empty values come last both ways, read by their own branch (by key). */
  nullable: boolean;
  /** What a cursor value must look like (anything else starts from the top). */
  valid: RegExp;
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ANY_TEXT = /^[\s\S]*$/;

/**
 * One index per sort, on (value, key): ascending reads it forward, descending backward, so the
 * order is (value, key) both ASC or both DESC, and the keyset start is a row comparison the
 * index scan starts from (no OR, no skipped rows: page N and a 500k-row CSV cost the same per
 * row). Migrations 20261119140525..45 build them.
 */
const SORTS: Record<ContactSort, SortSpec> = {
  last_seen: {expr: Prisma.sql`c.last_seen`, cast: Prisma.sql`timestamptz`, nullable: false, valid: ISO_MS},
  first_seen: {expr: Prisma.sql`c.first_seen`, cast: Prisma.sql`timestamptz`, nullable: false, valid: ISO_MS},
  name: {expr: Prisma.sql`lower(c.name)`, cast: Prisma.sql`text`, nullable: true, valid: ANY_TEXT},
  email: {expr: Prisma.sql`c.email`, cast: Prisma.sql`text`, nullable: true, valid: ANY_TEXT},
  responses: {expr: Prisma.sql`c.n`, cast: Prisma.sql`int`, nullable: false, valid: /^\d{1,9}$/},
};

const sortOf = (sort: ContactSort) => SORTS[sort] ?? SORTS.last_seen;

/** The sort value of a row as cursor text, selected beside the row. */
export function sortValue(sort: ContactSort): Sql {
  const {expr, valid} = sortOf(sort);
  return valid === ISO_MS
    ? Prisma.sql`to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    : Prisma.sql`(${expr})::text`;
}

/** A keyset position: the last row's sort value (null when empty) and its key. */
export interface ContactCursor {
  v: string | null;
  k: string;
}

/** The cursor if it can belong to this sort (a value of the right shape, or empty for a nullable one), else null. */
export function cursorFor(sort: ContactSort, cur: ContactCursor | null): ContactCursor | null {
  if (!cur) return null;
  const {nullable, valid} = sortOf(sort);
  if (cur.v === null) return nullable ? cur : null;
  return valid.test(cur.v) ? cur : null;
}

/** ORDER BY for one branch: the value then the key, both the same way (one index, either direction). */
export function orderFragment(sort: ContactSort, dir: 'asc' | 'desc'): Sql {
  const {expr} = sortOf(sort);
  const way = dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return Prisma.sql`${expr} ${way}, c.key ${way}`;
}

/** Rows with a value after `cur` (a row comparison: the index scan's start bound). */
export function afterFragment(sort: ContactSort, dir: 'asc' | 'desc', cur: ContactCursor): Sql {
  const {expr, cast} = sortOf(sort);
  if (cur.v === null) return Prisma.sql`false`;
  const op = dir === 'asc' ? Prisma.sql`>` : Prisma.sql`<`;
  return Prisma.sql`(${expr}, c.key) ${op} (${cur.v}::${cast}, ${cur.k}::text)`;
}

/**
 * One page of `contacts c` rows matching `where`, after `cursor`, in the sort's order. `columns`
 * are selected from `c`, plus `sort_v` (cursor text). A nullable sort reads rows with a value,
 * then (only if the page is not full) the empty ones by key: each branch is one index range.
 */
export function pageSql(sort: ContactSort, dir: 'asc' | 'desc', where: Sql, after: ContactCursor | null, limit: number, columns: Sql): Sql {
  const {expr, nullable} = sortOf(sort);
  const cursor = cursorFor(sort, after);
  const way = dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const cols = Prisma.sql`${columns}, ${sortValue(sort)} AS sort_v`;
  const valued = cursor ? afterFragment(sort, dir, cursor) : nullable ? Prisma.sql`${expr} IS NOT NULL` : Prisma.sql`true`;
  const first = Prisma.sql`SELECT ${cols}, 0 AS empty FROM contacts c WHERE ${where} AND ${valued} ORDER BY ${orderFragment(sort, dir)} LIMIT ${limit}`;
  if (!nullable) return first;
  // Empty values: all of them after any value; after an empty-valued cursor, by key.
  const op = dir === 'asc' ? Prisma.sql`>` : Prisma.sql`<`;
  const emptyAfter = cursor?.v === null ? Prisma.sql`c.key ${op} ${cursor.k}::text` : Prisma.sql`true`;
  const empty = Prisma.sql`SELECT ${cols}, 1 AS empty FROM contacts c WHERE ${where} AND ${expr} IS NULL AND ${emptyAfter} ORDER BY c.key ${way} LIMIT ${limit}`;
  const head = cursor?.v === null ? Prisma.empty : Prisma.sql`(${first}) UNION ALL `;
  return Prisma.sql`SELECT * FROM (${head}(${empty})) p ORDER BY p.empty, p.sort_v ${way}, p.key ${way} LIMIT ${limit}`;
}

/**
 * The page just BEFORE `before` (or, with no cursor, the last page), read in the reverse of the
 * list's order so it is the same index range walked backwards; the caller flips the rows. In the
 * list's order empty values come last, so backwards they come first: the empty branch (by key),
 * then, only if the page is not full, the valued one.
 */
export function pageBeforeSql(sort: ContactSort, dir: 'asc' | 'desc', where: Sql, before: ContactCursor | null, limit: number, columns: Sql): Sql {
  const {expr, nullable} = sortOf(sort);
  const cursor = cursorFor(sort, before);
  const back = dir === 'asc' ? 'desc' : 'asc';
  const way = back === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const cols = Prisma.sql`${columns}, ${sortValue(sort)} AS sort_v`;
  // Valued rows before a valued cursor; all of them from the end or from an empty-valued cursor.
  const valuedWhere =
    cursor && cursor.v !== null ? afterFragment(sort, back, cursor) : nullable ? Prisma.sql`${expr} IS NOT NULL` : Prisma.sql`true`;
  const valued = Prisma.sql`SELECT ${cols}, 1 AS empty FROM contacts c WHERE ${where} AND ${valuedWhere} ORDER BY ${orderFragment(sort, back)} LIMIT ${limit}`;
  if (!nullable || (cursor && cursor.v !== null)) return valued;
  const op = back === 'asc' ? Prisma.sql`>` : Prisma.sql`<`;
  const emptyBefore = cursor ? Prisma.sql`c.key ${op} ${cursor.k}::text` : Prisma.sql`true`;
  const empty = Prisma.sql`SELECT ${cols}, 0 AS empty FROM contacts c WHERE ${where} AND ${expr} IS NULL AND ${emptyBefore} ORDER BY c.key ${way} LIMIT ${limit}`;
  return Prisma.sql`SELECT * FROM ((${empty}) UNION ALL (${valued})) p ORDER BY p.empty, p.sort_v ${way}, p.key ${way} LIMIT ${limit}`;
}

/** At most `cap + 1` contacts matching `where`, counted: a bounded count, never the whole table. */
export function cappedCountSql(where: Sql, cap: number): Sql {
  return Prisma.sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM contacts c WHERE ${where} LIMIT ${cap + 1}) t`;
}

const toBase64Url = (text: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
};

/** `?cursor=` text ↔ ContactCursor (base64url JSON, UTF-8); null for anything malformed. */
export function encodeContactCursor(c: ContactCursor): string {
  return toBase64Url(JSON.stringify([c.v, c.k]));
}

export function decodeContactCursor(text: string | undefined): ContactCursor | null {
  if (!text || text.length > 1200) return null;
  try {
    const json = JSON.parse(fromBase64Url(text)) as unknown;
    if (!Array.isArray(json) || json.length !== 2) return null;
    const [v, k] = json as unknown[];
    if ((v !== null && typeof v !== 'string') || typeof k !== 'string' || k.length > 260) return null;
    if (typeof v === 'string' && v.length > 300) return null;
    return {v, k};
  } catch {
    return null;
  }
}
