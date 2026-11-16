import {Prisma} from '../../../generated/prisma/client';
import type {ContactSort, ContactsFilterQuery} from '../../../lib/intelform/api-contacts';

/**
 * SQL pieces for the contacts queries (pure: no database here, so they are unit-tested).
 * Every piece is a tagged `Prisma.sql` (values are bound parameters); identifiers and sort
 * expressions come only from the fixed maps below (docs/agent/security.md A05).
 *
 * Contacts are responses grouped by `responses.contact_key` ("e:<email>" or "p:<phone>"),
 * which the trigger in the intelform migration fills. Nothing is stored per contact: every
 * query aggregates responses on the fly, so there is nothing to keep in sync.
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

/**
 * The `c` CTE: one row per contact. Email, name, phone and country are the latest non-empty
 * values. `inner` narrows the responses scanned (one key for the detail, selected keys for CSV).
 */
export function contactsCte(inner: Sql = Prisma.sql`true`): Sql {
  return Prisma.sql`c AS (
    SELECT contact_key AS key,
      count(*)::int AS n,
      min(submitted_at) AS first_seen,
      max(submitted_at) AS last_seen,
      (array_agg(contact_email ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_email IS NOT NULL))[1] AS email,
      (array_agg(contact_name ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_name IS NOT NULL))[1] AS name,
      (array_agg(contact_phone ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_phone IS NOT NULL))[1] AS phone,
      (array_agg(country ORDER BY submitted_at DESC, id DESC) FILTER (WHERE country IS NOT NULL))[1] AS country,
      count(DISTINCT form_id)::int AS form_count,
      array_agg(DISTINCT form_id) AS form_ids
    FROM responses
    WHERE contact_key IS NOT NULL AND ${inner}
    GROUP BY contact_key
  )`;
}

/** Same expression as the responses contact-search trigram index (the intelform migration). */
const SEARCH_EXPR = Prisma.sql`(coalesce(contact_name, '') || ' ' || coalesce(contact_email, '') || ' ' || coalesce(contact_phone, ''))`;

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

/** WHERE on the `c` CTE for the list and CSV filters. */
export function filterFragment(q: ContactsFilterQuery, tz: string): Sql {
  const parts: Sql[] = [];
  if (q.q) {
    const match = or(searchPatterns(q.q).map(p => Prisma.sql`${SEARCH_EXPR} ILIKE ${p}`));
    parts.push(Prisma.sql`c.key IN (SELECT contact_key FROM responses WHERE contact_key IS NOT NULL AND (${match}))`);
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

const SORT_EXPR: Record<ContactSort, Sql> = {
  last_seen: Prisma.sql`c.last_seen`,
  first_seen: Prisma.sql`c.first_seen`,
  name: Prisma.sql`lower(c.name)`,
  email: Prisma.sql`c.email`,
  responses: Prisma.sql`c.n`,
};

/** ORDER BY from the fixed map; empty values last both ways, then latest activity, then key. */
export function orderFragment(sort: ContactSort, dir: 'asc' | 'desc'): Sql {
  const expr = SORT_EXPR[sort] ?? SORT_EXPR.last_seen;
  return dir === 'asc'
    ? Prisma.sql`${expr} ASC NULLS LAST, c.last_seen DESC, c.key ASC`
    : Prisma.sql`${expr} DESC NULLS LAST, c.last_seen DESC, c.key ASC`;
}

/** `/__platform/files/<id>/<name>` → `<id>` (a signature stored as a platform file), else null. */
export function platformFileId(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /^\/__platform\/files\/([A-Za-z0-9_-]{1,100})\//.exec(url);
  return m ? m[1]! : null;
}
