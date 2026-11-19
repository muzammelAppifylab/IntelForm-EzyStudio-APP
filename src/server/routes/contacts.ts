import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {
  contactDetailQuery,
  contactsListQuery,
  deleteContactsInput,
  type ContactDetailResponse,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '../../lib/intelform/api-contacts';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {LIST_KEYS, parseWith, rawQuery} from '../intelform/contacts/input';
import {applyContactBatch} from '../intelform/contacts/apply';
import {clearContactsOverview, contactDetail, contactsOverview, deleteContacts, listContacts} from '../intelform/contacts/query';
import {safeTz} from '../intelform/contacts/tz';
import {clearSummaryCache} from '../intelform/responses/summary';
import {scheduleFileCleanup} from '../intelform/uploads/trash';
import {logActivity} from '../activity';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/contacts/*`: people who answered any form, grouped by email (else phone). One row
 * per contact in the `contacts` table, kept by triggers on responses (contacts/sql.ts).
 *   GET  /                 list page (search, filters, sort, 50 per page, keyset `cursor`)
 *   GET  /overview         the strip and filter choices (whole workspace, cached 10 minutes)
 *   GET  /detail?key=      one contact and their latest 200 responses
 *   POST /delete           {keys} erases contacts: deletes every response they sent
 * The CSV is an export job: POST /site-api/exports {kind: 'contacts'} (routes/exports.ts).
 * Reading (and so every email shown) needs site:contact:read; erasing needs site:contact:write
 * AND site:response:delete (it deletes every response the contact sent).
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
      // Responses since the last notify run go into `contacts` first (one statement; nothing queued: an empty read).
      const [tz] = await Promise.all([safeTz(c.var.db, q.tz), applyContactBatch(c.var.db)]);
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
    await applyContactBatch(c.var.db);
    const detail = await contactDetail(c.var.db, parsed.data.key);
    if (!detail) return c.json(problem('not_found', UNKNOWN), 404);
    return c.json<ContactDetailResponse>(detail);
  })
  // Erasing a contact deletes their responses: it needs response deletion as well.
  .post(
    '/delete',
    deleteBody,
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.CONTACT_WRITE),
    requirePermission(PERMISSIONS.RESPONSE_DELETE),
    withDb,
    async c => {
      const {keys} = c.req.valid('json');
      const result = await deleteContacts(c.var.db, keys);
      if (result.contacts || result.responses) {
        await logActivity(c, 'contacts_deleted', undefined, {contacts: result.contacts, responses: result.responses});
      }
      // Their signature files are in the file trash (the delete trigger): the cleanup job removes
      // them a few at a time. The cached strip and the touched forms' summaries go now.
      if (result.responses) await Promise.all([clearContactsOverview(), clearSummaryCache(), scheduleFileCleanup(c.req.url)]);
      return c.json<DeleteContactsResponse>(result);
    }
  );
