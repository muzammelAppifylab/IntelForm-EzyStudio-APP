import {Hono, type Context} from 'hono';
import {validator} from 'hono/validator';
import * as z from 'zod';

import {
  bulkDeleteInput,
  responsesFilterQuery,
  summaryQuery,
  tablePrefsInput,
  type BulkDeleteResponse,
  type TableColumnPref,
  type TablePrefsResponse,
} from '../../lib/intelform/api-responses';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {GONE, loadCatalog} from '../intelform/responses/catalog';
import {decodeCursor} from '../intelform/responses/query';
import {cachedFormSummary, clearSummaryCache, SummaryRangeError} from '../intelform/responses/summary';
import {deleteResponses, listResponses, responseDetail} from '../intelform/responses/table';
import {clearContactsOverview} from '../intelform/contacts/query';
import {scheduleFileCleanup} from '../intelform/uploads/trash';

/**
 * `/site-api/responses/*`: a form's responses (IntelForm's Responses tab).
 *
 *   GET    /forms/:id/responses              table page: filters, search, sort, keyset `cursor` (50 rows)
 *   GET    /forms/:id/responses/prefs        this user's table columns
 *   PUT    /forms/:id/responses/prefs
 *   POST   /forms/:id/responses/bulk-delete  {ids}
 *   GET    /forms/:id/responses/:rid         the drawer: answers as submitted, prev / next
 *   DELETE /forms/:id/responses/:rid
 *   GET    /forms/:id/summary                aggregates per question, funnel, daily series (cached 5 min)
 *
 * CSV and ZIP exports are built by a background job: POST /site-api/exports (routes/exports.ts).
 *
 * The paths are IntelForm's `/api/forms/:id/...` ones under this mount, so the portal swaps
 * `/api/` for `/site-api/responses/`. Query strings: see src/lib/intelform/api-responses.ts
 * (repeated keys for `filter` and `ids`). Reading needs RESPONSE_READ, deleting RESPONSE_DELETE.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESPONSE_GONE = 'That response no longer exists.';
const ARRAY_KEYS = new Set(['filter', 'ids']);

type Issue = {path: PropertyKey[]; message: string};

/** 422 with the first problem as the message and one message per field. */
function invalid(c: Context, issues: readonly Issue[], fallback: string) {
  const fields: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join('.') || 'query';
    fields[key] ??= i.message;
  }
  const first = issues[0];
  const message = first ? `${first.path.map(String).join('.') || 'query'}: ${first.message}` : fallback;
  return c.json({...problem('invalid_input', message), fields}, 422);
}

/** A query-string validator: repeated keys become arrays for `filter` / `ids`, empty values are dropped. */
function query<T extends z.ZodType>(schema: T, keys: readonly string[]) {
  return validator('query', (value, c) => {
    const raw: Record<string, unknown> = {};
    for (const k of keys) {
      const v = value[k];
      const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
      if (ARRAY_KEYS.has(k)) raw[k] = list;
      else if (list[0] !== undefined && list[0] !== '') raw[k] = list[0];
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return invalid(c, parsed.error.issues, 'Check the filters.');
    return parsed.data as z.infer<T>;
  });
}

function json<T extends z.ZodType>(schema: T) {
  return validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return invalid(c, parsed.error.issues, 'Check what you sent.');
    return parsed.data as z.infer<T>;
  });
}

const FILTER_KEYS = ['q', 'from', 'to', 'tz', 'filter', 'has', 'sort', 'dir'] as const;

const listQuery = responsesFilterQuery.extend({
  /** The keyset position from the previous page's `nextCursor`. */
  cursor: z.string().max(1000).optional(),
  /** The page number the client shows; paging itself is by cursor. */
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/** A path uuid, or null (answered 404: a malformed id names nothing). */
const uuidParam = (c: Context, name: string): string | null => {
  const v = c.req.param(name);
  return v && UUID.test(v) ? v.toLowerCase() : null;
};

/**
 * After responses were deleted: the cached summary and contacts strip go, and the cleanup job
 * removes their signature files (the delete trigger put them in the file trash).
 */
async function afterDelete(c: Context, formId: string) {
  await Promise.all([clearSummaryCache(formId), clearContactsOverview(), scheduleFileCleanup(c.req.url)]);
}

const gone = (c: Context) => c.json(problem('not_found', GONE), 404);

export const responsesRoutes = new Hono()
  // ---------------------------------------------------------------- Column preferences (before /:rid)
  .get('/forms/:id/responses/prefs', withViewer, requireAuth, requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const formId = uuidParam(c, 'id');
    if (!formId) return gone(c);
    const db = c.var.db;
    const [form, pref] = await Promise.all([
      db.form.findUnique({where: {id: formId}, select: {id: true}}),
      db.responseTablePref.findUnique({
        where: {userId_formId: {userId: c.var.viewer.id!, formId}},
        select: {columns: true},
      }),
    ]);
    if (!form) return gone(c);
    const columns = Array.isArray(pref?.columns) ? (pref.columns as unknown as TableColumnPref[]) : null;
    return c.json<TablePrefsResponse>({columns});
  })

  .put(
    '/forms/:id/responses/prefs',
    json(tablePrefsInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidParam(c, 'id');
      if (!formId) return gone(c);
      const db = c.var.db;
      const userId = c.var.viewer.id!;
      // Drop duplicate ids, keeping the first; each column built field by field.
      const seen = new Set<string>();
      const columns: TableColumnPref[] = [];
      for (const col of c.req.valid('json').columns) {
        if (seen.has(col.id)) continue;
        seen.add(col.id);
        columns.push({id: col.id, visible: col.visible});
      }
      const form = await db.form.findUnique({
        where: {id: formId},
        select: {id: true},
      });
      if (!form) return gone(c);
      await db.responseTablePref.upsert({
        where: {userId_formId: {userId, formId}},
        create: {userId, formId, columns},
        update: {columns},
        select: {userId: true},
      });
      return c.json<TablePrefsResponse>({columns});
    }
  )

  // ---------------------------------------------------------------- Table, CSV, drawer
  .get(
    '/forms/:id/responses',
    query(listQuery, [...FILTER_KEYS, 'cursor', 'page']),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidParam(c, 'id');
      if (!formId) return gone(c);
      const q = c.req.valid('query');
      const cat = await loadCatalog(c.var.db, formId);
      if (!cat) return gone(c);
      const cursor = q.cursor ? decodeCursor(q.cursor) : null;
      if (q.cursor && !cursor) {
        return c.json(
          {
            ...problem('invalid_input', 'That page link is out of date. Reload the table.'),
            fields: {cursor: 'Not a valid cursor.'},
          },
          422
        );
      }
      return c.json(await listResponses(c.var.db, cat, {...q, cursor}));
    }
  )

  .post(
    '/forms/:id/responses/bulk-delete',
    json(bulkDeleteInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_DELETE),
    withDb,
    async c => {
      const formId = uuidParam(c, 'id');
      if (!formId) return gone(c);
      const ids = [...new Set(c.req.valid('json').ids.map(id => id.toLowerCase()))];
      const result = await deleteResponses(c.var.db, formId, ids);
      if (!result.formFound) return gone(c);
      if (result.deleted) await afterDelete(c, formId);
      return c.json<BulkDeleteResponse>({deleted: result.deleted});
    }
  )

  .get(
    '/forms/:id/responses/:rid',
    query(responsesFilterQuery, FILTER_KEYS),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidParam(c, 'id');
      if (!formId) return gone(c);
      const rid = uuidParam(c, 'rid');
      if (!rid) return c.json(problem('not_found', RESPONSE_GONE), 404);
      const cat = await loadCatalog(c.var.db, formId);
      if (!cat) return gone(c);
      const detail = await responseDetail(c.var.db, cat, rid, c.req.valid('query'));
      if (!detail) return c.json(problem('not_found', RESPONSE_GONE), 404);
      return c.json(detail);
    }
  )

  .delete('/forms/:id/responses/:rid', withViewer, requireAuth, requirePermission(PERMISSIONS.RESPONSE_DELETE), withDb, async c => {
    const formId = uuidParam(c, 'id');
    if (!formId) return gone(c);
    const rid = uuidParam(c, 'rid');
    if (!rid) return c.json(problem('not_found', RESPONSE_GONE), 404);
    const result = await deleteResponses(c.var.db, formId, [rid]);
    if (!result.formFound) return gone(c);
    if (!result.deleted) return c.json(problem('not_found', RESPONSE_GONE), 404);
    await afterDelete(c, formId);
    return c.json<BulkDeleteResponse>({deleted: result.deleted});
  })

  // ---------------------------------------------------------------- Summary
  .get(
    '/forms/:id/summary',
    query(summaryQuery, ['range', 'from', 'to', 'tz']),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidParam(c, 'id');
      if (!formId) return gone(c);
      const cat = await loadCatalog(c.var.db, formId);
      if (!cat) return gone(c);
      try {
        return c.json(await cachedFormSummary(c.var.db, cat, c.req.valid('query')));
      } catch (err) {
        if (err instanceof SummaryRangeError) {
          return c.json(
            {
              ...problem('invalid_input', err.message),
              fields: {from: err.message},
            },
            422
          );
        }
        throw err;
      }
    }
  );
