import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import type { JSONValue } from 'postgres'
import type * as z from 'zod'
import {
  bulkDeleteInput,
  responsesCsvQuery,
  responsesFilterQuery,
  responsesListQuery,
  summaryQuery,
  tablePrefsInput,
  type BulkDeleteResponse,
  type TablePrefsResponse,
} from '../../shared/api-responses'
import { sql } from '../db/client'
import { contentDisposition } from '../lib/csv'
import { registerFormCsvExporter } from '../lib/data-export'
import { ApiError, notFound } from '../lib/errors'
import { logger } from '../lib/logger'
import { readBody, uuidParam } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'
import { GONE } from '../responses/catalog'
import { csvFilename, exportFormCsv, formCsvChunks } from '../responses/csv'
import { safeTz, todayIn } from '../responses/query'
import { formSummary } from '../responses/summary'
import { deleteResponses, listResponses, responseDetail } from '../responses/table'

/** Responses: table data, drawer, delete, bulk delete, CSV export, summary aggregates. Mounted under /forms. Owned by: Agent G (responses) (see docs/AGENTS.md). */
export const responsesRoutes = new Hono<AppEnv>().use(requireUser)

// "Export all responses" (Settings → Data) writes each form's CSV with the same columns.
registerFormCsvExporter(exportFormCsv)

const ARRAY_KEYS = new Set(['filter', 'ids'])

/** Reads the query string into a schema; repeated keys become arrays. Invalid → 422. */
function readQuery<T extends z.ZodType>(c: Context, schema: T, keys: string[]): z.infer<T> {
  const raw: Record<string, unknown> = {}
  for (const k of keys) {
    if (ARRAY_KEYS.has(k)) raw[k] = c.req.queries(k) ?? []
    else {
      const v = c.req.query(k)
      if (v !== undefined && v !== '') raw[k] = v
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError(422, 'validation_failed', issue ? `${issue.path.join('.') || 'query'}: ${issue.message}` : 'Check the filters')
  }
  return parsed.data
}

const FILTER_KEYS = ['q', 'from', 'to', 'tz', 'filter', 'has', 'sort', 'dir']

async function assertForm(formId: string) {
  const [form] = await sql<{ title: string; slug: string }[]>`SELECT title, slug FROM forms WHERE id = ${formId}`
  if (!form) throw notFound(GONE)
  return form
}

// ------------------------------------------------------------------ Column preferences (before /:rid)

responsesRoutes.get('/:id/responses/prefs', requirePermission('responses.view'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  await assertForm(formId)
  const [row] = await sql<{ columns: TablePrefsResponse['columns'] }[]>`
    SELECT columns FROM response_table_prefs WHERE user_id = ${c.var.user.id} AND form_id = ${formId}
  `
  return c.json<TablePrefsResponse>({ columns: row?.columns ?? null })
})

responsesRoutes.put('/:id/responses/prefs', requirePermission('responses.view'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const body = await readBody(c, tablePrefsInput)
  await assertForm(formId)
  // Drop duplicate ids, keeping the first.
  const seen = new Set<string>()
  const columns = body.columns.filter((col) => !seen.has(col.id) && seen.add(col.id))
  await sql`
    INSERT INTO response_table_prefs (user_id, form_id, columns) VALUES (${c.var.user.id}, ${formId}, ${sql.json(columns as JSONValue)})
    ON CONFLICT (user_id, form_id) DO UPDATE SET columns = EXCLUDED.columns, updated_at = now()
  `
  return c.json<TablePrefsResponse>({ columns })
})

// ------------------------------------------------------------------ Table, CSV, drawer

responsesRoutes.get('/:id/responses', requirePermission('responses.view'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const q = readQuery(c, responsesListQuery, [...FILTER_KEYS, 'page'])
  return c.json(await listResponses(formId, q))
})

responsesRoutes.get('/:id/responses.csv', requirePermission('responses.view'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const q = readQuery(c, responsesCsvQuery, [...FILTER_KEYS, 'ids'])
  const form = await assertForm(formId)
  const tz = await safeTz(q.tz)
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', contentDisposition(csvFilename(form, todayIn(tz))))
  c.header('Cache-Control', 'no-store')
  return stream(
    c,
    async (s) => {
      let aborted = false
      s.onAbort(() => {
        aborted = true
      })
      for await (const chunk of formCsvChunks(formId, q, { aborted: () => aborted })) {
        if (aborted) break
        // write() resolves once the reader has taken the chunk: real backpressure.
        await s.write(chunk)
      }
    },
    async (err, s) => {
      logger.error({ err, formId }, 'csv export failed')
      await s.write('\r\nExport failed. Try again.\r\n').catch(() => {})
    },
  )
})

responsesRoutes.get('/:id/responses/:rid', requirePermission('responses.view'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const rid = uuidParam(c, 'rid', 'That response no longer exists')
  const q = readQuery(c, responsesFilterQuery, FILTER_KEYS)
  return c.json(await responseDetail(formId, rid, q))
})

responsesRoutes.delete('/:id/responses/:rid', requirePermission('responses.delete'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const rid = uuidParam(c, 'rid', 'That response no longer exists')
  const deleted = await deleteResponses(formId, [rid])
  if (!deleted) throw notFound('That response no longer exists')
  return c.json<BulkDeleteResponse>({ deleted })
})

responsesRoutes.post('/:id/responses/bulk-delete', requirePermission('responses.delete'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const { ids } = await readBody(c, bulkDeleteInput)
  const deleted = await deleteResponses(formId, [...new Set(ids)])
  return c.json<BulkDeleteResponse>({ deleted })
})

// ------------------------------------------------------------------ Summary

responsesRoutes.get('/:id/summary', requirePermission('responses.view'), async (c) => {
  const formId = uuidParam(c, 'id', GONE)
  const q = readQuery(c, summaryQuery, ['range', 'from', 'to', 'tz'])
  return c.json(await formSummary(formId, q))
})
