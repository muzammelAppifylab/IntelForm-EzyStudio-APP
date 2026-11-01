import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import type * as z from 'zod'
import {
  contactDetailQuery,
  contactsCsvQuery,
  contactsListQuery,
  deleteContactsInput,
  type ContactDetailResponse,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '../../shared/api-contacts'
import { contactDetail, contactsCsvChunks, contactsCsvFilename, contactsOverview, deleteContacts, listContacts } from '../contacts/query'
import { contentDisposition } from '../lib/csv'
import { ApiError, notFound } from '../lib/errors'
import { logger } from '../lib/logger'
import { readBody } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'
import { safeTz, todayIn } from '../responses/query'

/**
 * Contacts: people who answered any form, grouped by email (else phone). Mounted at /contacts.
 *   GET  /api/contacts             list, strip and facets
 *   GET  /api/contacts/detail?key= one contact and their responses
 *   GET  /api/contacts/export.csv  streamed CSV (filters, or repeated ?key=)
 *   POST /api/contacts/delete      deletes every response of the given contacts
 */
export const contactsRoutes = new Hono<AppEnv>().use(requireUser)

const ARRAY_KEYS = new Set(['form', 'country', 'has', 'key'])
const FILTER_KEYS = ['q', 'segment', 'form', 'country', 'has', 'from', 'to', 'tz', 'min', 'max', 'sort', 'dir']
const UNKNOWN = 'That contact no longer exists'

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

contactsRoutes.get('/', requirePermission('responses.view'), async (c) => {
  const q = readQuery(c, contactsListQuery, [...FILTER_KEYS, 'page'])
  return c.json<ContactsListResponse>(await listContacts(q))
})

/** Strip and filter choices: workspace-wide, fetched once rather than with every page. */
contactsRoutes.get('/overview', requirePermission('responses.view'), async (c) => c.json<ContactsOverviewResponse>(await contactsOverview()))

contactsRoutes.get('/detail', requirePermission('responses.view'), async (c) => {
  // A malformed key can't match anyone: same 404 as an unknown one.
  const parsed = contactDetailQuery.safeParse({ key: c.req.query('key') ?? '' })
  if (!parsed.success) throw notFound(UNKNOWN)
  const detail = await contactDetail(parsed.data.key)
  if (!detail) throw notFound(UNKNOWN)
  return c.json<ContactDetailResponse>(detail)
})

contactsRoutes.get('/export.csv', requirePermission('responses.view'), async (c) => {
  const q = readQuery(c, contactsCsvQuery, [...FILTER_KEYS, 'key'])
  const tz = await safeTz(q.tz)
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', contentDisposition(contactsCsvFilename(todayIn(tz))))
  c.header('Cache-Control', 'no-store')
  return stream(
    c,
    async (s) => {
      let aborted = false
      s.onAbort(() => {
        aborted = true
      })
      for await (const chunk of contactsCsvChunks(q, { aborted: () => aborted })) {
        if (aborted) break
        await s.write(chunk)
      }
    },
    async (err, s) => {
      logger.error({ err }, 'contacts csv export failed')
      await s.write('\r\nExport failed. Try again.\r\n').catch(() => {})
    },
  )
})

contactsRoutes.post('/delete', requirePermission('responses.delete'), async (c) => {
  const { keys } = await readBody(c, deleteContactsInput)
  return c.json<DeleteContactsResponse>(await deleteContacts(keys))
})
