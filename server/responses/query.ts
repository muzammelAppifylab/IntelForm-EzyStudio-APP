import type postgres from 'postgres'
import type { ResponsesFilterQuery } from '../../shared/api-responses'
import { COUNTRY_CODES, countryName } from '../../shared/form/types/registry'
import { sql } from '../db/client'
import type { FormCatalog } from './catalog'

/**
 * SQL fragments shared by the table, the drawer's prev / next and the CSV export:
 * the WHERE clause for the filters and the registry-driven sort expression.
 */

type Fragment = postgres.Fragment

// ------------------------------------------------------------------ Time zones

let pgZones: Promise<Set<string>> | null = null

/** A time zone both Postgres and Intl know; UTC otherwise. */
export async function safeTz(tz: string | undefined): Promise<string> {
  if (!tz) return 'UTC'
  pgZones ??= sql<{ name: string }[]>`SELECT name FROM pg_timezone_names`.then((rows) => new Set(rows.map((r) => r.name)))
  const zones = await pgZones.catch(() => new Set<string>())
  return zones.has(tz) ? tz : 'UTC'
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** submitted_at within local dates [from, to] in tz (DST-safe). */
export function rangeFragment(from: string | undefined, to: string | undefined, tz: string): Fragment {
  const parts: Fragment[] = []
  if (from) parts.push(sql`submitted_at >= (${from}::date::timestamp AT TIME ZONE ${tz})`)
  if (to) parts.push(sql`submitted_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`)
  return and(parts)
}

export function and(parts: Fragment[]): Fragment {
  if (!parts.length) return sql`true`
  return parts.reduce((a, p) => sql`${a} AND ${p}`)
}

function or(parts: Fragment[]): Fragment {
  if (!parts.length) return sql`false`
  return parts.reduce((a, p) => sql`${a} OR ${p}`)
}

// ------------------------------------------------------------------ Filters

/** A choice filter value as the jsonb that `answers @>` must contain. */
function containment(cat: FormCatalog, fieldId: string, value: string): object | null {
  const entry = cat.byId.get(fieldId)
  if (!entry) return null
  switch (entry.meta.type) {
    case 'single_choice':
    case 'dropdown':
      return { [fieldId]: { option: value } }
    case 'multiple_choice':
    case 'picture_choice':
      return { [fieldId]: [{ option: value }] }
    case 'yes_no':
      return value === 'true' || value === 'false' ? { [fieldId]: value === 'true' } : null
    case 'country':
      return /^[A-Z]{2}$/.test(value) ? { [fieldId]: value } : null
    case 'rating':
    case 'nps':
      return /^\d{1,2}$/.test(value) ? { [fieldId]: Number(value) } : null
    default:
      return null
  }
}

/** `%term%` for ILIKE, with the pattern characters escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** WHERE for one form and the table filters (no "responses." prefix: callers alias nothing). */
export function whereFragment(cat: FormCatalog, q: ResponsesFilterQuery, tz: string): Fragment {
  const parts: Fragment[] = [sql`form_id = ${cat.form.id}`]
  if (q.from || q.to) parts.push(rangeFragment(q.from, q.to, tz))
  if (q.q) parts.push(sql`search_text ILIKE ${likePattern(q.q)}`)
  if (q.has) parts.push(sql`answers ? ${q.has}`)
  const byField = new Map<string, object[]>()
  for (const f of q.filter) {
    const i = f.indexOf(':')
    const fieldId = f.slice(0, i)
    const json = containment(cat, fieldId, f.slice(i + 1))
    if (json) byField.set(fieldId, [...(byField.get(fieldId) ?? []), json])
  }
  for (const list of byField.values()) {
    parts.push(sql`(${or(list.map((j) => sql`answers @> ${sql.json(j as postgres.JSONValue)}`))})`)
  }
  return and(parts)
}

// ------------------------------------------------------------------ Sorting

let countryOrder: string[] | null = null

/**
 * The sort key for a column, NULL when unanswered (always sorted last). Choices sort by option
 * label via array_position over ids pre-sorted by label; numbers numerically; ISO dates and
 * times as text.
 */
export function sortExpression(cat: FormCatalog, column: string): Fragment {
  switch (column) {
    case 'submitted_at':
      return sql`submitted_at`
    case 'duration':
      return sql`duration_ms`
    case 'device':
      return sql`device`
    case 'browser':
      return sql`browser`
    case 'country':
      return sql`country`
  }
  const entry = cat.byId.get(column)
  if (!entry) return sql`submitted_at`
  const f = column
  const byLabel = () =>
    (entry.meta.options ?? [])
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
      .map((o) => o.id)
  switch (entry.meta.type) {
    case 'number':
    case 'rating':
    case 'nps':
      return sql`(CASE WHEN jsonb_typeof(answers->${f}) = 'number' THEN (answers->>${f})::numeric END)`
    case 'single_choice':
    case 'dropdown':
      return sql`array_position(${sql.array(byLabel())}::text[], answers->${f}->>'option')`
    case 'multiple_choice':
    case 'picture_choice':
      return sql`array_position(${sql.array(byLabel())}::text[], answers->${f}->0->>'option')`
    case 'yes_no':
      return sql`(CASE WHEN jsonb_typeof(answers->${f}) = 'boolean' THEN (answers->>${f})::boolean END)`
    case 'country':
      countryOrder ??= COUNTRY_CODES.slice().sort((a, b) => countryName(a).localeCompare(countryName(b)))
      return sql`array_position(${sql.array(countryOrder)}::text[], answers->>${f})`
    case 'name':
      return sql`lower(CASE jsonb_typeof(answers->${f}) WHEN 'string' THEN answers->>${f}
        WHEN 'object' THEN concat_ws(' ', answers->${f}->>'first', answers->${f}->>'last') END)`
    case 'address':
      return sql`lower(coalesce(answers->${f}->>'street', answers->${f}->>'city', answers->${f}->>'country'))`
    case 'consent':
      return sql`(answers->${f}->>'accepted')`
    case 'signature':
      return sql`(CASE WHEN answers ? ${f} THEN 1 END)`
    case 'date':
    case 'time':
      return sql`(answers->>${f})`
    default:
      return sql`lower(answers->>${f})`
  }
}

export interface SortSpec {
  expr: Fragment
  dir: 'asc' | 'desc'
  /** Tie-breaker direction on id. */
  tie: 'asc' | 'desc'
  /** submitted_at is NOT NULL: plain ORDER BY so the (form_id, submitted_at DESC, id DESC) index serves it. */
  notNull: boolean
}

export function sortSpec(cat: FormCatalog, column: string, dir: 'asc' | 'desc'): SortSpec {
  // Unknown columns fall back to submitted_at in sortExpression.
  const notNull = column === 'submitted_at' || (!cat.byId.has(column) && !['duration', 'device', 'browser', 'country'].includes(column))
  // Ascending by submitted_at walks the same index backwards, so its tie-breaker flips too.
  return { expr: sortExpression(cat, column), dir, tie: notNull && dir === 'asc' ? 'asc' : 'desc', notNull }
}

const D = (d: 'asc' | 'desc') => (d === 'asc' ? sql`ASC` : sql`DESC`)
const flip = (d: 'asc' | 'desc') => (d === 'asc' ? 'desc' : 'asc')

/** ORDER BY: the key (unanswered last both ways), then id. */
export function orderFragment(s: SortSpec): Fragment {
  if (s.notNull) return sql`${s.expr} ${D(s.dir)}, id ${D(s.tie)}`
  return sql`${s.expr} ${D(s.dir)} NULLS LAST, id ${D(s.tie)}`
}

/** The reverse order (for "previous" lookups): NULLs first, every direction flipped. */
export function reverseOrderFragment(s: SortSpec): Fragment {
  if (s.notNull) return sql`${s.expr} ${D(flip(s.dir))}, id ${D(flip(s.tie))}`
  return sql`${s.expr} ${D(flip(s.dir))} NULLS FIRST, id ${D(flip(s.tie))}`
}

/**
 * Keyset conditions relative to a current row whose key is `cur.k` and id `cur.kid` (a CTE the
 * caller cross-joins). "after" = later in the table order, "before" = earlier.
 */
export function keysetFragments(s: SortSpec): { after: Fragment; before: Fragment } {
  const lt = (a: Fragment, b: Fragment) => sql`${a} < ${b}`
  const gt = (a: Fragment, b: Fragment) => sql`${a} > ${b}`
  const eAfter = s.dir === 'desc' ? lt : gt
  const eBefore = s.dir === 'desc' ? gt : lt
  const idAfter = s.tie === 'desc' ? sql`id < cur.kid` : sql`id > cur.kid`
  const idBefore = s.tie === 'desc' ? sql`id > cur.kid` : sql`id < cur.kid`
  const e = s.expr
  const k = sql`cur.k`
  return {
    after: sql`(CASE WHEN cur.k IS NULL THEN ${e} IS NULL AND ${idAfter}
      ELSE ${eAfter(e, k)} OR (${e} = cur.k AND ${idAfter}) OR ${e} IS NULL END)`,
    before: sql`(CASE WHEN cur.k IS NULL THEN ${e} IS NOT NULL OR ${idBefore}
      ELSE ${eBefore(e, k)} OR (${e} = cur.k AND ${idBefore}) END)`,
  }
}
