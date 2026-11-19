import {Hono, type Context} from 'hono';
import {validator} from 'hono/validator';

import {contactsCsvQuery} from '../../lib/intelform/api-contacts';
import {startExportInput, type ExportKind, type ExportStatus} from '../../lib/intelform/api-exports';
import {responsesCsvQuery} from '../../lib/intelform/api-responses';
import {permissionScope, problem, requireAuth, withDb, withViewer} from '../../platform/guards';
import {CSV_KEYS, parseWith, rawQuery} from '../intelform/contacts/input';
import {contactsCsvFilename} from '../intelform/contacts/query';
import {failStaleExports, loadExport, markSendPending, sendExportRun, STALE_MINUTES, statusOf} from '../intelform/exports/job';
import {csvFilename} from '../intelform/responses/csv';
import {contentDisposition} from '../intelform/responses/csv-text';
import {safeTz, todayIn} from '../intelform/responses/query';
import {hitRateLimit} from '../intelform/responses/rate-limit';
import {logActivity} from '../activity';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/exports/*`: CSV and ZIP exports, built by the `intelform-exports` background job
 * (src/server/intelform/exports/job.ts) so a big export never runs in a request.
 *
 *   POST /                 {kind, formId?, query?} → 202 ExportStatus (src/lib/intelform/api-exports.ts)
 *   GET  /:id              ExportStatus, for the person who started it
 *   GET  /:id/download     the finished file (its stored parts, streamed in order)
 *
 * Permissions per kind, checked when it starts AND on every read: `responses`
 * site:response:read, `contacts` site:contact:read, `all` site:intelform:settings plus both of those. 10 exports
 * per person per 10 minutes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'That export no longer exists. Start it again.';
const RESPONSE_KEYS = ['q', 'from', 'to', 'tz', 'filter', 'has', 'sort', 'dir', 'ids'];
const RESPONSE_ARRAYS = new Set(['filter', 'ids']);

const PERMISSION: Record<ExportKind, string> = {
  responses: PERMISSIONS.RESPONSE_READ,
  contacts: PERMISSIONS.CONTACT_READ,
  all: PERMISSIONS.APP_SETTINGS,
};

// `all` holds every response and contact: app settings alone are not enough to read them.
const mayExport = async (c: Context, kind: ExportKind) => {
  if ((await permissionScope(c, PERMISSION[kind])) !== 'all') return false;
  if (kind !== 'all') return true;
  const [responses, contacts] = await Promise.all([
    permissionScope(c, PERMISSIONS.RESPONSE_READ),
    permissionScope(c, PERMISSIONS.CONTACT_READ),
  ]);
  return responses === 'all' && contacts === 'all';
};

const body = validator('json', (value, c) => {
  const parsed = startExportInput.safeParse(value);
  if (!parsed.success) return c.json(problem('invalid_input', 'Say what to export.'), 422);
  return parsed.data;
});

/** The table's query record → the responses CSV query (repeated keys become arrays). */
function responsesQuery(record: Record<string, string | string[]>) {
  const raw: Record<string, unknown> = {};
  for (const k of RESPONSE_KEYS) {
    const v = record[k];
    const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
    if (RESPONSE_ARRAYS.has(k)) raw[k] = list.filter(x => x !== '');
    else if (list[0] !== undefined && list[0] !== '') raw[k] = list[0];
  }
  return responsesCsvQuery.safeParse(raw);
}

export const exportsRoutes = new Hono()
  .post('/', body, withViewer, requireAuth, withDb, async c => {
    const input = c.req.valid('json');
    if (!(await mayExport(c, input.kind))) return c.json(problem('forbidden', 'You do not have access to this.'), 403);
    // Starting one is a write (a background job and a stored file): a read-only role can't.
    if ((await permissionScope(c, PERMISSIONS.RESPONSE_EXPORT)) !== 'all') {
      return c.json(problem('forbidden', 'Exporting needs permission to export responses. Ask an admin.'), 403);
    }
    const db = c.var.db;
    const userId = c.var.viewer.id!;
    if (!(await hitRateLimit(db, `export:${userId}`, 10, 10 * 60))) {
      return c.json(problem('rate_limited', 'You exported a lot just now. Try again in a few minutes.'), 429);
    }

    const origin = new URL(c.req.url).origin;
    let formId: string | null = null;
    let params: Record<string, unknown>;
    let fileName: string;
    let contentType = 'text/csv; charset=utf-8';
    if (input.kind === 'responses') {
      const parsed = responsesQuery(input.query);
      if (!parsed.success) return c.json(problem('invalid_input', 'Check the filters.'), 422);
      const tz = safeTz(parsed.data.tz);
      const form = await db.form.findUnique({where: {id: input.formId}, select: {id: true, title: true, slug: true}});
      if (!form) return c.json(problem('not_found', 'That form no longer exists.'), 404);
      formId = form.id;
      params = {query: parsed.data, tz, origin};
      fileName = csvFilename(form, todayIn(tz));
    } else if (input.kind === 'contacts') {
      const parsed = parseWith(contactsCsvQuery, rawQuery(input.query, CSV_KEYS));
      if (!parsed.ok) return c.json({...problem('invalid_input', parsed.message), fields: parsed.fields}, 422);
      const tz = safeTz(parsed.data.tz);
      params = {query: parsed.data, tz};
      fileName = contactsCsvFilename(todayIn(tz));
    } else {
      params = {origin};
      fileName = `responses ${new Date().toISOString().slice(0, 10)}.zip`;
      contentType = 'application/zip';
    }

    const [row] = await db.$queryRaw<{id: string; created_at: Date}[]>`
      INSERT INTO intelform_exports (user_id, kind, form_id, params, file_name, content_type)
      VALUES (${userId}, ${input.kind}, ${formId}::uuid, ${JSON.stringify(params)}::jsonb, ${fileName}, ${contentType})
      RETURNING id::text AS id, created_at
    `;
    try {
      await sendExportRun(c.req.url, row!.id, 0);
    } catch {
      // Busy (the jobs limit) or unreachable: the every-minute job sends it (resendPendingExports).
      await markSendPending(db, row!.id, 0);
    }
    await logActivity(c, 'export_started', formId ? ['form', formId] : undefined, {kind: input.kind});
    // Locally the job has already run (sendJob runs it in this process): answer what it did.
    const now = await loadExport(db, row!.id);
    return c.json<ExportStatus>(statusOf(now ?? {...row!, kind: input.kind, status: 'running', rows: 0, file_name: fileName, error: null}), 202);
  })

  .get('/:id', withViewer, requireAuth, withDb, async c => {
    const id = c.req.param('id');
    const db = c.var.db;
    let row = UUID.test(id) ? await loadExport(db, id) : null;
    if (!row || row.user_id !== c.var.viewer.id || !(await mayExport(c, row.kind))) return c.json(problem('not_found', NOT_FOUND), 404);
    // A run that stopped (out of tries, lost) never finishes: say so now, not after the sweep.
    if (row.status === 'running' && Date.now() - new Date(row.updated_at).getTime() > STALE_MINUTES * 60_000) {
      if (await failStaleExports(db, id)) row = (await loadExport(db, id)) ?? row;
    }
    c.header('Cache-Control', 'private, no-store');
    return c.json<ExportStatus>(statusOf(row));
  })

  .get('/:id/download', withViewer, requireAuth, withDb, async c => {
    const id = c.req.param('id');
    const db = c.var.db;
    const row = UUID.test(id) ? await loadExport(db, id) : null;
    if (!row || row.user_id !== c.var.viewer.id || !(await mayExport(c, row.kind))) return c.json(problem('not_found', NOT_FOUND), 404);
    if (row.status !== 'ready') return c.json(problem('not_ready', 'This export isn’t ready yet.'), 409);
    // The stored parts in order, one read per part as the browser takes them (no CPU work here).
    let seq = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          if (seq >= row.parts) return controller.close();
          const [part] = await db.$queryRaw<{data: Uint8Array}[]>`
            SELECT data FROM intelform_export_parts WHERE export_id = ${id}::uuid AND seq = ${seq}::int
          `;
          seq++;
          if (!part) return controller.error(new Error('A part of the export is missing.'));
          controller.enqueue(new Uint8Array(part.data));
        },
      },
      {highWaterMark: 0}
    );
    return new Response(stream, {
      headers: {
        'Content-Type': row.content_type,
        'Content-Length': String(Number(row.bytes)),
        'Content-Disposition': contentDisposition(row.file_name),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
