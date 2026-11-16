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
  /** Can be NULL (empty values sort last both ways). */
  nullable: boolean;
}

const SORTS: Record<ContactSort, SortSpec> = {
  last_seen: {expr: Prisma.sql`c.last_seen`, cast: Prisma.sql`timestamptz`, nullable: false},
  first_seen: {expr: Prisma.sql`c.first_seen`, cast: Prisma.sql`timestamptz`, nullable: false},
  name: {expr: Prisma.sql`lower(c.name)`, cast: Prisma.sql`text`, nullable: true},
  email: {expr: Prisma.sql`c.email`, cast: Prisma.sql`text`, nullable: true},
  responses: {expr: Prisma.sql`c.n`, cast: Prisma.sql`int`, nullable: false},
};

const sortOf = (sort: ContactSort) => SORTS[sort] ?? SORTS.last_seen;
/** Sorted by latest activity already (an unknown sort falls back to it): no tie-break column. */
const byActivity = (sort: ContactSort) => sortOf(sort) === SORTS.last_seen;

/** The sort value of a row as cursor text (`(expr)::text`), selected beside the row. */
export function sortValue(sort: ContactSort): Sql {
  const {expr} = sortOf(sort);
  return sort === 'last_seen' || sort === 'first_seen'
    ? Prisma.sql`to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    : Prisma.sql`(${expr})::text`;
}

/** The latest activity as cursor text (the tie-break after the sort value). */
export const LAST_SEEN_TEXT = Prisma.sql`to_char(c.last_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * ORDER BY from the fixed map; empty values last both ways, then the latest activity, then the
 * key (the indexes end the same way).
 */
export function orderFragment(sort: ContactSort, dir: 'asc' | 'desc'): Sql {
  const {expr, nullable} = sortOf(sort);
  const way = dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const head = nullable ? Prisma.sql`(${expr} IS NULL), ${expr} ${way}` : Prisma.sql`${expr} ${way}`;
  return byActivity(sort) ? Prisma.sql`${head}, c.key ASC` : Prisma.sql`${head}, c.last_seen DESC, c.key ASC`;
}

/** A keyset position: the last row's sort value (null when empty), its latest activity and key. */
export interface ContactCursor {
  v: string | null;
  t: string;
  k: string;
}

/** Rows after `cur` in orderFragment's order. */
export function afterFragment(sort: ContactSort, dir: 'asc' | 'desc', cur: ContactCursor): Sql {
  const {expr, cast, nullable} = sortOf(sort);
  // Within one sort value: later in (last_seen DESC, key ASC).
  const tie =
    byActivity(sort)
      ? Prisma.sql`c.key > ${cur.k}`
      : Prisma.sql`(c.last_seen < ${cur.t}::timestamptz OR (c.last_seen = ${cur.t}::timestamptz AND c.key > ${cur.k}))`;
  if (cur.v === null) return Prisma.sql`(${expr} IS NULL AND ${tie})`;
  const v = Prisma.sql`${cur.v}::${cast}`;
  const past = dir === 'asc' ? Prisma.sql`${expr} > ${v}` : Prisma.sql`${expr} < ${v}`;
  const tail = nullable ? Prisma.sql`${expr} IS NULL OR ` : Prisma.empty;
  return Prisma.sql`(${tail}${past} OR (${expr} = ${v} AND ${tie}))`;
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

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** `?cursor=` text ↔ ContactCursor (base64url JSON, UTF-8); null for anything malformed. */
export function encodeContactCursor(c: ContactCursor): string {
  return toBase64Url(JSON.stringify([c.v, c.t, c.k]));
}

export function decodeContactCursor(text: string | undefined): ContactCursor | null {
  if (!text || text.length > 1200) return null;
  try {
    const json = JSON.parse(fromBase64Url(text)) as unknown;
    if (!Array.isArray(json) || json.length !== 3) return null;
    const [v, t, k] = json as unknown[];
    if ((v !== null && typeof v !== 'string') || typeof t !== 'string' || !ISO_MS.test(t) || typeof k !== 'string' || k.length > 260) return null;
    if (typeof v === 'string' && v.length > 300) return null;
    return {v, t, k};
  } catch {
    return null;
  }
}
