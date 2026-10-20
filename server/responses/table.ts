import type {
  DrawerAnswer,
  ResponseDetail,
  ResponseRow,
  ResponsesFilterQuery,
  ResponsesListQuery,
  ResponsesListResponse,
} from '../../shared/api-responses'
import { RESPONSES_PAGE_SIZE } from '../../shared/api-responses'
import type { FormDefinition, FormField } from '../../shared/form/definition'
import { interpolate } from '../../shared/form/logic'
import { sql } from '../db/client'
import { notFound } from '../lib/errors'
import { removeSignatureUrls } from '../lib/uploads'
import { loadCatalog, parseField, type FormCatalog } from './catalog'
import { displayAnswer } from './format'
import { keysetFragments, orderFragment, reverseOrderFragment, safeTz, sortSpec, whereFragment } from './query'

/** Table page and drawer data. */

interface DbRow {
  id: string
  submitted_at: Date
  duration_ms: number | null
  device: string | null
  browser: string | null
  country: string | null
  answers: Record<string, unknown>
}

/** Display text per field, plus the signature image URLs (only files this server stored). */
export function rowCells(cat: FormCatalog, answers: Record<string, unknown>): Pick<ResponseRow, 'cells' | 'urls'> {
  const cells: Record<string, string> = {}
  const urls: Record<string, string> = {}
  for (const e of cat.entries) {
    const v = answers[e.meta.id]
    if (v === undefined) continue
    const d = displayAnswer(e.display, v)
    if (d.text) cells[e.meta.id] = d.text
    if (d.url) urls[e.meta.id] = d.url
  }
  return Object.keys(urls).length ? { cells, urls } : { cells }
}

export async function listResponses(formId: string, q: ResponsesListQuery): Promise<ResponsesListResponse> {
  const cat = await loadCatalog(formId)
  const tz = await safeTz(q.tz)
  const where = whereFragment(cat, q, tz)
  const sort = sortSpec(cat, q.sort, q.dir)
  const offset = (q.page - 1) * RESPONSES_PAGE_SIZE
  const [rows, [{ total }], [{ form_total }]] = await Promise.all([
    sql<DbRow[]>`
      SELECT id, submitted_at, duration_ms, device, browser, country, answers FROM responses
      WHERE ${where} ORDER BY ${orderFragment(sort)} LIMIT ${RESPONSES_PAGE_SIZE} OFFSET ${offset}
    `,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM responses WHERE ${where}`,
    sql<{ form_total: number }[]>`SELECT count(*)::int AS form_total FROM responses WHERE form_id = ${formId}`,
  ])
  return {
    fields: cat.entries.map((e) => e.meta),
    rows: rows.map(
      (r): ResponseRow => ({
        id: r.id,
        submittedAt: r.submitted_at.toISOString(),
        durationMs: r.duration_ms,
        device: r.device,
        browser: r.browser,
        country: r.country,
        ...rowCells(cat, r.answers),
      }),
    ),
    total,
    formTotal: form_total,
    page: q.page,
    pageSize: RESPONSES_PAGE_SIZE,
  }
}

/** Neighbours of `rid` within the filter and sort, by keyset, plus its 1-based position. */
async function neighbours(cat: FormCatalog, rid: string, q: ResponsesFilterQuery) {
  const tz = await safeTz(q.tz)
  const where = whereFragment(cat, q, tz)
  const sort = sortSpec(cat, q.sort, q.dir)
  const { after, before } = keysetFragments(sort)
  const cur = sql`cur AS (SELECT ${sort.expr} AS k, id AS kid FROM responses WHERE id = ${rid} AND form_id = ${cat.form.id})`
  const [[next], [prev], [counts]] = await Promise.all([
    sql<{ id: string }[]>`WITH ${cur} SELECT id FROM responses, cur WHERE ${where} AND ${after} ORDER BY ${orderFragment(sort)} LIMIT 1`,
    sql<{ id: string }[]>`WITH ${cur} SELECT id FROM responses, cur WHERE ${where} AND ${before} ORDER BY ${reverseOrderFragment(sort)} LIMIT 1`,
    sql<{ before: number; total: number }[]>`
      WITH ${cur} SELECT count(*) FILTER (WHERE ${before})::int AS before, count(*)::int AS total FROM responses, cur WHERE ${where}
    `,
  ])
  return { prevId: prev?.id ?? null, nextId: next?.id ?? null, position: (counts?.before ?? 0) + 1, total: counts?.total ?? 0 }
}

export async function responseDetail(formId: string, rid: string, q: ResponsesFilterQuery): Promise<ResponseDetail> {
  const cat = await loadCatalog(formId)
  const [row] = await sql<(DbRow & { started_at: Date | null; version: number; definition: FormDefinition })[]>`
    SELECT r.id, r.submitted_at, r.started_at, r.duration_ms, r.device, r.browser, r.country, r.answers, v.version, v.definition
    FROM responses r JOIN form_versions v ON v.id = r.form_version_id
    WHERE r.id = ${rid} AND r.form_id = ${formId}
  `
  if (!row) throw notFound('That response no longer exists')
  const fields = (Array.isArray(row.definition?.fields) ? row.definition.fields : [])
    .map(parseField)
    .filter((f): f is FormField => !!f && f.type !== 'section_break')
  const def = { ...row.definition, fields } as FormDefinition
  const answers: DrawerAnswer[] = fields.map((f) => {
    // Labels as submitted, with options as they were on that version.
    const d = displayAnswer(f, row.answers[f.id])
    const label = interpolate(f.label, def, row.answers).trim() || 'Untitled question'
    return { fieldId: f.id, type: f.type, label, text: d.text, ...(d.url && { url: d.url }) }
  })
  const nav = await neighbours(cat, rid, q)
  return {
    id: row.id,
    formVersion: row.version,
    submittedAt: row.submitted_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    durationMs: row.duration_ms,
    device: row.device,
    browser: row.browser,
    country: row.country,
    answers,
    ...nav,
  }
}

/**
 * Deletes responses of one form and keeps forms.response_count / last_response_at in sync.
 * Their signature PNGs are deleted from storage once the transaction has committed.
 */
export async function deleteResponses(formId: string, ids: string[]): Promise<number> {
  const urls: string[] = []
  const count = await sql.begin(async (tx) => {
    // Lock the form row so concurrent deletes and submits serialise on the counter.
    const [form] = await tx`SELECT id FROM forms WHERE id = ${formId} FOR UPDATE`
    if (!form) throw notFound('That form no longer exists')
    const deleted = await tx<{ sig_urls: string[] }[]>`
      DELETE FROM responses WHERE form_id = ${formId} AND id = ANY(${sql.array(ids)}::uuid[])
      RETURNING ARRAY(
        SELECT v->>'url' FROM jsonb_each(answers) e(k, v)
        WHERE jsonb_typeof(v) = 'object' AND v->>'url' LIKE '%/intelform/signatures/%'
      ) AS sig_urls
    `
    for (const r of deleted) urls.push(...r.sig_urls)
    if (deleted.count > 0) {
      await tx`
        UPDATE forms SET
          response_count = (SELECT count(*)::int FROM responses WHERE form_id = ${formId}),
          last_response_at = (SELECT max(submitted_at) FROM responses WHERE form_id = ${formId})
        WHERE id = ${formId}
      `
    }
    return deleted.count
  })
  await removeSignatureUrls(urls)
  return count
}
