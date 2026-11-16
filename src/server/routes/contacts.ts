import {type Context, Hono} from 'hono';
import {validator} from 'hono/validator';

import {
  contactDetailQuery,
  contactsCsvQuery,
  contactsListQuery,
  deleteContactsInput,
  type ContactDetailResponse,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '../../lib/intelform/api-contacts';
import {deleteFile} from '../../platform/files';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {contentDisposition} from '../intelform/contacts/csv';
import {CSV_KEYS, LIST_KEYS, parseWith, rawQuery} from '../intelform/contacts/input';
import {contactDetail, contactsCsvChunks, contactsCsvFilename, contactsOverview, deleteContacts, listContacts} from '../intelform/contacts/query';
import {safeTz, todayIn} from '../intelform/contacts/tz';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/contacts/*`: people who answered any form, grouped by email (else phone). Derived
 * from responses: there is no contacts table to keep in sync.
 *   GET  /                 list page (search, filters, sort, 50 per page, with the matching total)
 *   GET  /overview         the strip and filter choices (whole workspace, ignoring filters)
 *   GET  /detail?key=      one contact and their latest 200 responses
 *   GET  /export.csv       streamed CSV (the filters, or repeated ?key=)
 *   POST /delete           {keys} erases contacts: deletes every response they sent
 * Reading (and so every email shown) needs site:contact:read; erasing needs site:contact:write.
 */

const UNKNOWN = 'That contact no longer exists.';

type Query = Record<string, string | string[] | undefined>;

const queryWith = <S extends Parameters<typeof parseWith>[0]>(schema: S, keys: readonly string[]) =>
  validator('query', (value, c) => {
    const parsed = parseWith(schema, rawQuery(value as Query, keys));
    if (!parsed.ok) return c.json({...problem('invalid_input', parsed.message), fields: parsed.fields}, 422);
    return parsed.data as ReturnType<S['parse']>;
  });

const deleteBody = validator('json', (value, c) => {
  const parsed = parseWith(deleteContactsInput, value);
  if (!parsed.ok) {
    const message = parsed.fields.keys ?? 'Select at least one contact.';
    return c.json({...problem('invalid_input', message), fields: parsed.fields}, 422);
  }
  return parsed.data;
});

/** Removes the deleted responses' signature files after commit, without delaying the answer. */
function removeFilesLater(c: Context, fileIds: string[]) {
  if (!fileIds.length) return;
  const work = Promise.allSettled(fileIds.slice(0, 1000).map(id => deleteFile(c.req.url, id))).then(results => {
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)).length;
    if (failed) console.error(`[contacts] ${failed} signature file(s) not removed`);
  });
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (a test calling the app directly): the promise still runs.
  }
}

export const contactsRoutes = new Hono()
  .get(
    '/',
    queryWith(contactsListQuery, LIST_KEYS),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.CONTACT_READ),
    withDb,
    async c => {
      const q = c.req.valid('query');
      const tz = await safeTz(c.var.db, q.tz);
      return c.json<ContactsListResponse>(await listContacts(c.var.db, q, tz));
    }
  )
  .get('/overview', withViewer, requireAuth, requirePermission(PERMISSIONS.CONTACT_READ), withDb, async c =>
    c.json<ContactsOverviewResponse>(await contactsOverview(c.var.db))
  )
  .get('/detail', withViewer, requireAuth, requirePermission(PERMISSIONS.CONTACT_READ), withDb, async c => {
    // A malformed key can't match anyone: the same 404 as an unknown one.
    const parsed = contactDetailQuery.safeParse({key: c.req.query('key') ?? ''});
    if (!parsed.success) return c.json(problem('not_found', UNKNOWN), 404);
    const detail = await contactDetail(c.var.db, parsed.data.key);
    if (!detail) return c.json(problem('not_found', UNKNOWN), 404);
    return c.json<ContactDetailResponse>(detail);
  })
  .get(
    '/export.csv',
    queryWith(contactsCsvQuery, CSV_KEYS),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.CONTACT_READ),
    withDb,
    async c => {
      const q = c.req.valid('query');
      const db = c.var.db;
      const tz = await safeTz(db, q.tz);
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', contentDisposition(contactsCsvFilename(todayIn(tz))));
      c.header('Cache-Control', 'private, no-store');
      // Pull-based: each batch is read only when the client takes the previous one (bounded memory).
      const chunks = contactsCsvChunks(db, q, tz);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const next = await chunks.next();
              if (next.done) controller.close();
              else controller.enqueue(encoder.encode(next.value));
            } catch (err) {
              console.error(`[contacts] csv export failed: ${(err as Error).message}`.slice(0, 500));
              controller.enqueue(encoder.encode('\r\nExport failed. Try again.\r\n'));
              controller.close();
            }
          },
          async cancel() {
            await chunks.return(undefined);
          },
        },
        {highWaterMark: 0}
      );
      return c.body(body);
    }
  )
  .post('/delete', deleteBody, withViewer, requireAuth, requirePermission(PERMISSIONS.CONTACT_WRITE), withDb, async c => {
    const {keys} = c.req.valid('json');
    const {contacts, responses, fileIds} = await deleteContacts(c.var.db, keys);
    removeFilesLater(c, fileIds);
    return c.json<DeleteContactsResponse>({contacts, responses});
  });
