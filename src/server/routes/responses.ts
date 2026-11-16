import {Hono, type Context} from 'hono';
import {validator} from 'hono/validator';
import * as z from 'zod';

import {
  bulkDeleteInput,
  responsesCsvQuery,
  responsesFilterQuery,
  summaryQuery,
  tablePrefsInput,
  type BulkDeleteResponse,
  type TableColumnPref,
  type TablePrefsResponse,
} from '../../lib/intelform/api-responses';
import {deleteFile} from '../../platform/files';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {GONE, loadCatalog} from '../intelform/responses/catalog';
import {byteStream, csvFilename, formCsvChunks} from '../intelform/responses/csv';
import {contentDisposition} from '../intelform/responses/csv-text';
import {exportAllResponsesZip} from '../intelform/responses/export-all';
import {decodeCursor, safeTz, todayIn} from '../intelform/responses/query';
import {hitRateLimit} from '../intelform/responses/rate-limit';
import {formSummary, SummaryRangeError} from '../intelform/responses/summary';
import {deleteResponses, listResponses, responseDetail} from '../intelform/responses/table';

/**
 * `/site-api/responses/*`: a form's responses (IntelForm's Responses tab).
 *
 *   GET    /forms/:id/responses              table page: filters, search, sort, keyset `cursor` (50 rows)
 *   GET    /forms/:id/responses.csv          CSV, streamed: the table's filters and sort, or `ids`
 *   GET    /forms/:id/responses/prefs        this user's table columns
 *   PUT    /forms/:id/responses/prefs
 *   POST   /forms/:id/responses/bulk-delete  {ids}
 *   GET    /forms/:id/responses/:rid         the drawer: answers as submitted, prev / next
 *   DELETE /forms/:id/responses/:rid
 *   GET    /forms/:id/summary                aggregates per question, funnel, daily series
 *   GET    /export-all.zip                   every form's CSV in one ZIP (Settings → Data)
 *
 * The paths are IntelForm's `/api/forms/:id/...` ones under this mount, so the portal swaps
 * `/api/` for `/site-api/responses/`. Query strings: see src/lib/intelform/api-responses.ts
 * (repeated keys for `filter` and `ids`). Reading needs RESPONSE_READ, deleting
 * RESPONSE_DELETE, the all-forms ZIP APP_SETTINGS (it was IntelForm's settings.manage).
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

/** Background work after the answer (file removals); runs inline where there is no execution context. */
function afterResponse(c: Context, work: Promise<unknown>) {
  const settled = work.catch(err => console.error(`responses: cleanup failed: ${err instanceof Error ? err.message : 'error'}`));
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    void settled;
  }
}

/** Removes stored files, a few at a time. Best effort: a failure leaves an orphaned file, never a broken answer. */
async function removeFiles(requestUrl: string, ids: readonly string[]) {
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.allSettled(ids.slice(i, i + 5).map(id => deleteFile(requestUrl, id)));
  }
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

  .get(
    '/forms/:id/responses.csv',
    query(responsesCsvQuery, [...FILTER_KEYS, 'ids']),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidParam(c, 'id');
      if (!formId) return gone(c);
      const q = c.req.valid('query');
      const db = c.var.db;
      // Loaded before streaming so a missing form is a 404.
      const cat = await loadCatalog(db, formId);
      if (!cat) return gone(c);
      const tz = safeTz(q.tz);
      let aborted = false;
      const body = byteStream(formCsvChunks(db, cat, q, {aborted: () => aborted}), err =>
        console.error(`responses: csv export of ${formId} failed: ${err instanceof Error ? err.message : 'error'}`)
      );
      c.req.raw.signal?.addEventListener('abort', () => (aborted = true));
      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': contentDisposition(csvFilename(cat.form, todayIn(tz))),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
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
      const cat = await loadCatalog(c.var.db, formId);
      if (!cat) return gone(c);
      const signatureIds = cat.entries.filter(e => e.meta.type === 'signature').map(e => e.meta.id);
      const result = await deleteResponses(c.var.db, formId, ids, signatureIds);
      if (!result.formFound) return gone(c);
      if (result.fileIds.length) afterResponse(c, removeFiles(c.req.url, result.fileIds));
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
    const cat = await loadCatalog(c.var.db, formId);
    if (!cat) return gone(c);
    const signatureIds = cat.entries.filter(e => e.meta.type === 'signature').map(e => e.meta.id);
    const result = await deleteResponses(c.var.db, formId, [rid], signatureIds);
    if (!result.formFound) return gone(c);
    if (!result.deleted) return c.json(problem('not_found', RESPONSE_GONE), 404);
    if (result.fileIds.length) afterResponse(c, removeFiles(c.req.url, result.fileIds));
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
        return c.json(await formSummary(c.var.db, cat, c.req.valid('query')));
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
  )

  // ---------------------------------------------------------------- Every form, one ZIP
  .get('/export-all.zip', withViewer, requireAuth, requirePermission(PERMISSIONS.APP_SETTINGS), withDb, async c => {
    const db = c.var.db;
    if (!(await hitRateLimit(db, `export-all:${c.var.viewer.id}`, 5, 10 * 60))) {
      return c.json(problem('rate_limited', 'You exported a lot just now. Try again in a few minutes.'), 429);
    }
    let aborted = false;
    c.req.raw.signal?.addEventListener('abort', () => (aborted = true));
    const body = byteStream(
      exportAllResponsesZip(db, () => aborted),
      err => console.error(`responses: export-all failed: ${err instanceof Error ? err.message : 'error'}`),
      null
    );
    const today = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition(`responses ${today}.zip`),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
