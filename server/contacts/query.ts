import type postgres from 'postgres'
import {
  CONTACTS_PAGE_SIZE,
  type ContactDetailResponse,
  type ContactFormRef,
  type ContactRow,
  type ContactSort,
  type ContactsCsvQuery,
  type ContactsFilterQuery,
  type ContactsListQuery,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '../../shared/api-contacts'
import { sql, withoutStatementTimeout } from '../db/client'
import { CSV_BOM, csvRow } from '../lib/csv'
import { removeSignatureUrls } from '../lib/uploads'
import { and, likePattern, safeTz } from '../responses/query'
import { deleteLockedResponses } from '../responses/table'

/**
 * Contacts: responses grouped by `responses.contact_key` ("e:<email>" or "p:<phone>"), filled by
 * the trigger in migration 0008_contacts.sql. Every query aggregates responses on the fly, so
 * there is nothing to keep in sync when responses are submitted or deleted.
 */

type Fragment = postgres.Fragment

interface DbContact {
  key: string
  n: number
  first_seen: Date
  last_seen: Date
  email: string | null
  name: string | null
  phone: string | null
  country: string | null
  form_count: number
}

/**
 * The `c` CTE: one row per contact. Email, name, phone and country are the latest non-empty
 * values. `inner` narrows the responses scanned (e.g. one key for the detail page).
 */
function contactsCte(inner: Fragment = sql`true`): Fragment {
  return sql`c AS (
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
  )`
}

/** Same expression as the responses_contact_search trigram index. */
const searchExpr = () => sql`(coalesce(contact_name, '') || ' ' || coalesce(contact_email, '') || ' ' || coalesce(contact_phone, ''))`

function or(parts: Fragment[]): Fragment {
  if (!parts.length) return sql`false`
  return parts.reduce((a, p) => sql`${a} OR ${p}`)
}

/** `col` within local dates [from, to] in tz, DST-safe. */
function dayRange(col: Fragment, from: string | undefined, to: string | undefined, tz: string): Fragment[] {
  const parts: Fragment[] = []
  if (from) parts.push(sql`${col} >= (${from}::date::timestamp AT TIME ZONE ${tz})`)
  if (to) parts.push(sql`${col} < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`)
  return parts
}

/** WHERE on the `c` CTE for the list and CSV filters. */
export function filterFragment(q: ContactsFilterQuery, tz: string): Fragment {
  const parts: Fragment[] = []
  if (q.q) {
    const patterns = [likePattern(q.q)]
    // "+44 20 7946" should find "+442079460000": also try the query without phone punctuation.
    const compact = q.q.replace(/[\s().-]/g, '')
    if (compact !== q.q && compact.length >= 3) patterns.push(likePattern(compact))
    const match = or(patterns.map((p) => sql`${searchExpr()} ILIKE ${p}`))
    parts.push(sql`c.key IN (SELECT contact_key FROM responses WHERE contact_key IS NOT NULL AND (${match}))`)
  }
  if (q.segment === 'returning') parts.push(sql`c.n >= 2`)
  if (q.segment === 'new') {
    const range = dayRange(sql`c.first_seen`, q.from, q.to, tz)
    parts.push(range.length ? and(range) : sql`c.first_seen >= now() - interval '7 days'`)
  }
  if (q.form.length) parts.push(sql`c.form_ids && ${sql.array(q.form)}::uuid[]`)
  if (q.country.length) parts.push(sql`c.country = ANY(${sql.array(q.country)}::text[])`)
  for (const h of new Set(q.has)) {
    if (h === 'email') parts.push(sql`c.email IS NOT NULL`)
    else if (h === 'phone') parts.push(sql`c.phone IS NOT NULL`)
    else parts.push(sql`c.name IS NOT NULL`)
  }
  parts.push(...dayRange(sql`c.last_seen`, q.from, q.to, tz))
  if (q.min !== undefined) parts.push(sql`c.n >= ${q.min}`)
  if (q.max !== undefined) parts.push(sql`c.n <= ${q.max}`)
  return and(parts)
}

/** ORDER BY from a whitelist; empty values last both ways, then latest activity, then key. */
export function orderFragment(sort: ContactSort, dir: 'asc' | 'desc'): Fragment {
  const d = dir === 'asc' ? sql`ASC` : sql`DESC`
  const expr: Record<ContactSort, () => Fragment> = {
    last_seen: () => sql`c.last_seen`,
    first_seen: () => sql`c.first_seen`,
    name: () => sql`lower(c.name)`,
    email: () => sql`c.email`,
    responses: () => sql`c.n`,
  }
  return sql`${(expr[sort] ?? expr.last_seen)()} ${d} NULLS LAST, c.last_seen DESC, c.key ASC`
}

// ------------------------------------------------------------------ Forms per contact

interface DbContactForm {
  key: string
  id: string
  title: string
  status: ContactFormRef['status']
  responses: number
}

/** Each contact's forms with response counts, most recently answered first. */
async function formsByKey(keys: string[]): Promise<Map<string, (ContactFormRef & { responses: number })[]>> {
  const out = new Map<string, (ContactFormRef & { responses: number })[]>()
  if (!keys.length) return out
  const rows = await sql<DbContactForm[]>`
    SELECT r.contact_key AS key, f.id, f.title, f.status, count(*)::int AS responses
    FROM responses r JOIN forms f ON f.id = r.form_id
    WHERE r.contact_key = ANY(${sql.array(keys)}::text[])
    GROUP BY r.contact_key, f.id
    ORDER BY r.contact_key, max(r.submitted_at) DESC, f.id
  `
  for (const r of rows) {
    const list = out.get(r.key) ?? []
    list.push({ id: r.id, title: r.title, status: r.status, responses: r.responses })
    out.set(r.key, list)
  }
  return out
}

function toRow(c: DbContact, forms: ContactFormRef[]): ContactRow {
  return {
    key: c.key,
    email: c.email,
    name: c.name,
    phone: c.phone,
    country: c.country,
    responseCount: c.n,
    forms: forms.slice(0, 3).map(({ id, title, status }) => ({ id, title, status })),
    formCount: c.form_count,
    firstSeen: c.first_seen.toISOString(),
    lastSeen: c.last_seen.toISOString(),
  }
}

// ------------------------------------------------------------------ List, strip, facets

type Overview = ContactsOverviewResponse

/** Workspace-wide numbers and filter choices, ignoring every filter. */
export async function contactsOverview(): Promise<Overview> {
  const [[s], forms] = await Promise.all([
    sql<{ total: number; new_week: number; returning: number; with_phone: number; countries: { code: string; contacts: number }[] }[]>`
      WITH ${contactsCte()}
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE first_seen >= now() - interval '7 days')::int AS new_week,
        count(*) FILTER (WHERE n >= 2)::int AS returning,
        count(*) FILTER (WHERE phone IS NOT NULL)::int AS with_phone,
        (SELECT coalesce(json_agg(x ORDER BY x.contacts DESC, x.code), '[]'::json)
         FROM (SELECT country AS code, count(*)::int AS contacts FROM c WHERE country IS NOT NULL GROUP BY country) x) AS countries
      FROM c
    `,
    sql<(ContactFormRef & { contacts: number })[]>`
      SELECT f.id, f.title, f.status, count(DISTINCT r.contact_key)::int AS contacts
      FROM responses r JOIN forms f ON f.id = r.form_id
      WHERE r.contact_key IS NOT NULL
      GROUP BY f.id
      ORDER BY contacts DESC, f.title, f.id
    `,
  ])
  const formRefs = forms.map(({ id, title, status, contacts }) => ({ id, title, status, contacts }))
  return {
    strip: {
      total: s.total,
      newThisWeek: s.new_week,
      returning: s.returning,
      withPhonePct: s.total ? Math.round((s.with_phone / s.total) * 100) : 0,
      topForms: formRefs.slice(0, 3),
    },
    facets: { forms: formRefs, countries: s.countries },
  }
}

export async function listContacts(q: ContactsListQuery): Promise<ContactsListResponse> {
  const tz = await safeTz(q.tz)
  const where = filterFragment(q, tz)
  const offset = (q.page - 1) * CONTACTS_PAGE_SIZE
  const rows = await sql<(DbContact & { total: number })[]>`
    WITH ${contactsCte()}
    SELECT c.key, c.n, c.first_seen, c.last_seen, c.email, c.name, c.phone, c.country, c.form_count,
      count(*) OVER ()::int AS total
    FROM c WHERE ${where}
    ORDER BY ${orderFragment(q.sort, q.dir)}
    LIMIT ${CONTACTS_PAGE_SIZE} OFFSET ${offset}
  `
  let total = rows[0]?.total ?? 0
  if (!rows.length && q.page > 1) {
    // Past the last page: the window count saw no rows, so count separately.
    const [r] = await sql<{ total: number }[]>`WITH ${contactsCte()} SELECT count(*)::int AS total FROM c WHERE ${where}`
    total = r.total
  }
  const forms = await formsByKey(rows.map((r) => r.key))
  return {
    contacts: rows.map((r) => toRow(r, forms.get(r.key) ?? [])),
    total,
    page: q.page,
    pageSize: CONTACTS_PAGE_SIZE,
  }
}

// ------------------------------------------------------------------ Detail

const DETAIL_RESPONSES = 200

export async function contactDetail(key: string): Promise<ContactDetailResponse | null> {
  const [contact] = await sql<DbContact[]>`
    WITH ${contactsCte(sql`contact_key = ${key}`)}
    SELECT key, n, first_seen, last_seen, email, name, phone, country, form_count FROM c
  `
  if (!contact) return null
  const [forms, responses] = await Promise.all([
    formsByKey([key]),
    sql<{ id: string; submitted_at: Date; duration_ms: number | null; device: string | null; country: string | null; form_id: string; title: string; status: ContactFormRef['status'] }[]>`
      SELECT r.id, r.submitted_at, r.duration_ms, r.device, r.country, f.id AS form_id, f.title, f.status
      FROM responses r JOIN forms f ON f.id = r.form_id
      WHERE r.contact_key = ${key}
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT ${DETAIL_RESPONSES}
    `,
  ])
  const list = forms.get(key) ?? []
  return {
    contact: toRow(contact, list),
    responses: responses.map((r) => ({
      id: r.id,
      form: { id: r.form_id, title: r.title, status: r.status },
      submittedAt: r.submitted_at.toISOString(),
      durationMs: r.duration_ms,
      device: r.device,
      country: r.country,
    })),
    forms: list,
  }
}

// ------------------------------------------------------------------ Delete

/**
 * Erases contacts: every response they sent, on every form, in one transaction (all or
 * nothing). forms.response_count / last_response_at stay right; signature files are removed
 * once it has committed.
 */
export async function deleteContacts(keys: string[]): Promise<DeleteContactsResponse> {
  const unique = [...new Set(keys)]
  const urls: string[] = []
  const result = await sql.begin(async (tx) => {
    const groups = await tx<{ form_id: string; ids: string[]; keys: string[] }[]>`
      SELECT form_id, array_agg(id) AS ids, array_agg(DISTINCT contact_key) AS keys
      FROM responses WHERE contact_key = ANY(${sql.array(unique)}::text[])
      GROUP BY form_id
    `
    if (!groups.length) return { contacts: 0, responses: 0 }
    // Lock every form involved in id order, so two deletes (or a delete and a submit) can't deadlock.
    const locked = await tx<{ id: string }[]>`
      SELECT id FROM forms WHERE id = ANY(${sql.array(groups.map((g) => g.form_id))}::uuid[]) ORDER BY id FOR UPDATE
    `
    const live = new Set(locked.map((f) => f.id))
    const found = new Set<string>()
    let responses = 0
    for (const g of groups) {
      // A form deleted meanwhile took its responses with it.
      if (!live.has(g.form_id)) continue
      responses += await deleteLockedResponses(tx, g.form_id, g.ids, urls)
      for (const k of g.keys) found.add(k)
    }
    return { contacts: found.size, responses }
  })
  await removeSignatureUrls(urls)
  return result
}

// ------------------------------------------------------------------ CSV

const CSV_HEADERS = ['Name', 'Email', 'Phone', 'Country', 'Responses', 'Forms', 'First seen', 'Last active']
const CURSOR_ROWS = 500

/** Streamed CSV of the filtered contacts (or just `q.key`), BOM first, in the list's order. */
export async function* contactsCsvChunks(q: ContactsCsvQuery, opts: { aborted?: () => boolean } = {}): AsyncGenerator<string> {
  const tz = await safeTz(q.tz)
  const cte = q.key.length ? contactsCte(sql`contact_key = ANY(${sql.array(q.key)}::text[])`) : contactsCte()
  const where = q.key.length ? sql`true` : filterFragment(q, tz)
  yield CSV_BOM + csvRow(CSV_HEADERS)
  // A cursor is one statement for its whole life: lift the pool's statement_timeout while streaming.
  yield* withoutStatementTimeout(async function* (db) {
    const cursor = db<{ name: string | null; email: string | null; phone: string | null; country: string | null; n: number; forms: string | null; first_txt: string; last_txt: string }[]>`
      WITH ${cte}
      SELECT c.name, c.email, c.phone, c.country, c.n,
        (SELECT string_agg(x.title, '; ' ORDER BY x.last DESC)
         FROM (SELECT f.title, max(r.submitted_at) AS last FROM responses r JOIN forms f ON f.id = r.form_id
               WHERE r.contact_key = c.key GROUP BY f.id) x) AS forms,
        to_char(c.first_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS first_txt,
        to_char(c.last_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS last_txt
      FROM c WHERE ${where}
      ORDER BY ${orderFragment(q.sort, q.dir)}
    `.cursor(CURSOR_ROWS)
    // Breaking out of for-await closes the cursor (postgres.js cancels the rest).
    for await (const rows of cursor) {
      if (opts.aborted?.()) return
      let chunk = ''
      for (const r of rows) chunk += csvRow([r.name, r.email, r.phone, r.country, r.n, r.forms, r.first_txt, r.last_txt])
      yield chunk
    }
  })
}

export function contactsCsvFilename(today: string): string {
  return `Contacts ${today}.csv`
}
