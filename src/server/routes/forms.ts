import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Prisma} from '../../generated/prisma/client';
import {
  createFormInput,
  deleteFormInput,
  formsViewInput,
  saveAsTemplateInput,
  type CreatedForm,
  type FormDetail,
  type FormsListResponse,
  type FormsStrip,
  type FormStatus,
  type FormStatusResponse,
  type FormsViewResponse,
  type TemplateSummary,
} from '../../lib/intelform/api-forms';
import {blankDefinition, type FormDefinition} from '../../lib/intelform/form/definition';
import {clientSettings, copyableSettings, defaultFormSettings, type FormSettings} from '../../lib/intelform/form/settings';
import {remapTemplateIds} from '../../lib/intelform/form/templates/remap';
import type {FormTheme} from '../../lib/intelform/form/theme';
import {permissionScope, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {
  countFields,
  decodeCursor,
  FormsError,
  hasTheme,
  listQuery,
  normalizeDraft,
  notFound,
  readSettings,
  readTheme,
  repairOrBlank,
  savedTemplateSlug,
} from '../intelform/forms/core';
import {sumShards} from '../intelform/forms/counts';
import {fail, formIdParam, zodJson} from '../intelform/forms/http';
import {
  closeForm,
  formsStrip,
  clearFormsStrip,
  insertForm,
  listForms,
  newFormDefaults,
  reopenForm,
} from '../intelform/forms/store';
import {clearPublicSiteCache} from '../intelform/public-site/data';
import {clearPublicFormCache, clearPublicFormCacheFor} from '../intelform/respondent/cache';
import {findBuiltinTemplate} from '../intelform/templates/builtins';
import {scheduleFileCleanup} from '../intelform/uploads/trash';
import {clearSummaryCache} from '../intelform/responses/summary';
import {clearContactsOverview} from '../intelform/contacts/query';
import {logActivity, titleMeta} from '../activity';
import {PERMISSIONS} from '../permissions';
import {isDemoViewer} from '../demo-role';

/**
 * `/site-api/forms/*`: IntelForm's dashboard forms (ported from IntelForm's server/routes/forms.ts).
 *
 *   GET    /                 list: search, status filter, sort, keyset pages     FORM_READ
 *   GET    /strip            the weekly numbers above the list                   FORM_READ
 *   GET    /prefs/view       grid or list, per user                              FORM_READ
 *   PATCH  /prefs/view                                                           FORM_READ
 *   POST   /                 create: blank, or from a template (id or slug)      FORM_WRITE
 *   GET    /:id              the builder's form (webhook secrets hidden from readers) FORM_READ
 *   GET    /recent-responses the newest responses across forms (the Overview)    RESPONSE_READ
 *   (PATCH /:id autosave and POST /:id/publish are intelform/builder/form-routes.ts,
 *    mounted at /site-api/forms just before this app)
 *   POST   /:id/close        /:id/reopen                                          FORM_WRITE
 *   POST   /:id/duplicate                                                         FORM_WRITE
 *   POST   /:id/save-as-template                                                  FORM_WRITE
 *   DELETE /:id              with the typed title `{confirmTitle}`                FORM_DELETE
 *
 * Every route: validator → withViewer → requireAuth → requirePermission → withDb.
 * Errors: `{error: code, message, fields?}`.
 */

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

export const formsRoutes = new Hono()
  // ------------------------------------------------------------------ list --
  .get(
    '/',
    validator('query', v => listQuery.parse(v)),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_READ),
    withDb,
    async c => {
      const query = c.req.valid('query');
      const cursor = decodeCursor(query.cursor, query.sort);
      const page = await listForms(c.var.db, query, cursor, cursor ? null : decodeCursor(query.before, query.sort));
      return c.json<FormsListResponse>({
        forms: page.forms,
        total: page.total,
        matched: page.matched,
        page: page.page,
        pageSize: page.pageSize,
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
      });
    }
  )

  .get('/strip', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    return c.json<FormsStrip>(await formsStrip(c.var.db));
  })

  // -------------------------------------------- grid / list view, per user --
  .get('/recent-responses', withViewer, requireAuth, requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const rows = await c.var.db.response.findMany({
      orderBy: [{submittedAt: 'desc'}, {id: 'desc'}],
      take: 6,
      select: {id: true, formId: true, submittedAt: true, contactName: true, contactEmail: true, form: {select: {title: true}}},
    });
    c.header('Cache-Control', 'private, no-store');
    return c.json({
      responses: rows.map(r => ({
        id: r.id,
        formId: r.formId,
        formTitle: r.form.title,
        submittedAt: r.submittedAt.toISOString(),
        contactName: r.contactName,
        contactEmail: r.contactEmail,
      })),
    });
  })

  .get('/prefs/view', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const row = await c.var.db.userPref.findUnique({
      where: {userId_key: {userId: c.var.viewer.id!, key: 'forms.view'}},
      select: {value: true},
    });
    return c.json<FormsViewResponse>({view: row?.value === 'grid' ? 'grid' : 'list'});
  })

  .patch(
    '/prefs/view',
    zodJson(formsViewInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_READ),
    withDb,
    async c => {
      const {view} = c.req.valid('json');
      const userId = c.var.viewer.id!;
      // The read-only demo: the list keeps the view for this visit, nothing is stored.
      if (await isDemoViewer(c)) return c.json<FormsViewResponse>({view});
      await c.var.db.userPref.upsert({
        where: {userId_key: {userId, key: 'forms.view'}},
        create: {userId, key: 'forms.view', value: view},
        update: {value: view},
        select: {userId: true},
      });
      return c.json<FormsViewResponse>({view});
    }
  )

  // ---------------------------------------------------------------- create --
  .post('/', zodJson(createFormInput), withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    try {
      const input = c.req.valid('json');
      const db = c.var.db;
      const wantsTemplate = !!(input.templateId || input.templateSlug);

      const builtin = wantsTemplate ? findBuiltinTemplate(input.templateId ?? input.templateSlug) : undefined;
      const [appDefaults, saved] = await Promise.all([
        newFormDefaults(db),
        wantsTemplate && !builtin
          ? db.template.findFirst({
              where: input.templateId ? {id: input.templateId} : {slug: input.templateSlug ?? ''},
              select: {name: true, definition: true, theme: true, settings: true},
            })
          : null,
      ]);

      let title = input.title ?? 'Untitled form';
      let draft: FormDefinition = blankDefinition();
      let theme: FormTheme = appDefaults.theme;
      let settings: FormSettings = {...defaultFormSettings(), timezone: appDefaults.timezone, ...appDefaults.limits};

      if (wantsTemplate) {
        const tpl = builtin ?? saved;
        if (!tpl) throw notFound('That template no longer exists');
        title = input.title ?? tpl.name;
        if (hasTheme(tpl.theme)) theme = readTheme(tpl.theme);
        // Fresh field and option ids per form, with logic, pipes and settings references rewritten.
        ({definition: draft, settings} = remapTemplateIds(
          normalizeDraft(tpl.definition),
          copyableSettings(readSettings(tpl.settings), true)
        ));
        if (!settings.closeAt) settings = {...settings, timezone: appDefaults.timezone};
        // A template carries its own content, never another site's spam limits.
        settings = {...settings, ...appDefaults.limits};
      }

      const created = await insertForm(db, {title, draft, theme, settings, userId: c.var.viewer.id!});
      await logActivity(c, 'form_created', ['form', created.id], {title: titleMeta(created.title), fromTemplate: wantsTemplate});
      return c.json<CreatedForm>(created, 201);
    } catch (err) {
      return fail(c, err);
    }
  })

  // ------------------------------------------------------------------ read --
  .get('/:id', formIdParam, withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const {id} = c.req.valid('param');
    const [row, canEdit] = await Promise.all([
      c.var.db.form.findUnique({
        where: {id},
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          draft: true,
          theme: true,
          settings: true,
          revision: true,
          publishedVersionId: true,
          hasUnpublished: true,
          // The exact count (the header compares it right after a delete): the form's
          // form_counts shards (at most 16) in the same query, summed below.
          counts: {select: {responses: true}, take: 16},
          createdAt: true,
          updatedAt: true,
          publishedVersion: {select: {version: true, publishedAt: true}},
          updatedBy: {select: {id: true, name: true}},
        },
      }),
      // Like the webhook routes: the URL and header values are secrets that carry responses, so
      // seeing them needs both editing forms and reading responses.
      Promise.all([permissionScope(c, PERMISSIONS.FORM_WRITE), permissionScope(c, PERMISSIONS.RESPONSE_READ)]).then(
        ([write, read]) => write === 'all' && read === 'all'
      ),
    ]);
    if (!row) return fail(c, notFound());

    const draft = repairOrBlank(row.draft);
    return c.json<FormDetail>({
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status as FormStatus,
      draft,
      theme: readTheme(row.theme),
      // Readers get the webhook URL and header values blanked: they are secrets.
      settings: clientSettings(readSettings(row.settings), {canEdit}),
      revision: row.revision,
      publishedVersion: row.publishedVersion?.version ?? null,
      publishedAt: row.publishedVersion?.publishedAt.toISOString() ?? null,
      hasUnpublished: row.hasUnpublished && row.publishedVersionId !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy ? {id: row.updatedBy.id, name: row.updatedBy.name} : null,
      counts: {...countFields(draft), responses: sumShards(row.counts)},
    });
  })

  // --------------------------------------------------------- close, reopen --
  .post('/:id/close', formIdParam, withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    try {
      const {id} = c.req.valid('param');
      const result = await closeForm(c.var.db, id, c.var.viewer.id!);
      await logActivity(c, 'form_closed', ['form', id]);
      await Promise.all([clearPublicSiteCache(), clearPublicFormCacheFor(c.var.db, id)]);
      return c.json<FormStatusResponse>(result);
    } catch (err) {
      return fail(c, err);
    }
  })

  .post('/:id/reopen', formIdParam, withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    try {
      const {id} = c.req.valid('param');
      const result = await reopenForm(c.var.db, id, c.var.viewer.id!);
      await logActivity(c, 'form_reopened', ['form', id]);
      await Promise.all([clearPublicSiteCache(), clearPublicFormCacheFor(c.var.db, id)]);
      return c.json<FormStatusResponse>(result);
    } catch (err) {
      return fail(c, err);
    }
  })

  // ---------------------------------------- duplicate, save as template, delete --
  .post('/:id/duplicate', formIdParam, withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    try {
      const {id} = c.req.valid('param');
      const db = c.var.db;
      const row = await db.form.findUnique({where: {id}, select: {title: true, draft: true, theme: true, settings: true}});
      if (!row) throw notFound();
      // Copies the definition, theme and settings only: never responses or the webhook secret. The webhook
      // keeps its URL and headers but is switched off until the owner sets up the new secret (copyableSettings).
      const created = await insertForm(db, {
        title: `Copy of ${row.title}`.slice(0, 200),
        draft: repairOrBlank(row.draft),
        theme: readTheme(row.theme),
        settings: copyableSettings(readSettings(row.settings)),
        userId: c.var.viewer.id!,
      });
      await logActivity(c, 'form_duplicated', ['form', created.id], {title: titleMeta(created.title), source: titleMeta(row.title)});
      return c.json<CreatedForm>(created, 201);
    } catch (err) {
      return fail(c, err);
    }
  })

  .post(
    '/:id/save-as-template',
    formIdParam,
    zodJson(saveAsTemplateInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_WRITE),
    withDb,
    async c => {
      const {id} = c.req.valid('param');
      const input = c.req.valid('json');
      const db = c.var.db;
      const row = await db.form.findUnique({where: {id}, select: {title: true, draft: true, theme: true, settings: true}});
      if (!row) return fail(c, notFound());
      const definition = repairOrBlank(row.draft);
      // Templates are the whole team's: no password, webhook target or recipients (copyableSettings).
      const tpl = await db.template.create({
        data: {
          slug: savedTemplateSlug(),
          name: (input.name ?? row.title).slice(0, 120),
          category: input.category ?? 'Saved',
          description: input.description ?? '',
          definition: asJson(definition),
          theme: asJson(readTheme(row.theme)),
          settings: asJson(copyableSettings(readSettings(row.settings), true)),
          sortOrder: 1000,
          createdById: c.var.viewer.id!,
        },
        select: {id: true, slug: true, name: true, category: true, description: true, createdAt: true},
      });
      await logActivity(c, 'form_saved_as_template', ['template', tpl.id], {title: titleMeta(tpl.name), source: titleMeta(row.title)});
      return c.json<TemplateSummary>(
        {
          id: tpl.id,
          slug: tpl.slug,
          name: tpl.name,
          category: tpl.category,
          description: tpl.description,
          isBuiltin: false,
          layout: definition.layout,
          fieldCount: countFields(definition).fields,
          createdBy: c.var.viewer.name ?? null,
          createdAt: tpl.createdAt.toISOString(),
        },
        201
      );
    }
  )

  .delete(
    '/:id',
    formIdParam,
    zodJson(deleteFormInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_DELETE),
    withDb,
    async c => {
      const {id} = c.req.valid('param');
      const {confirmTitle} = c.req.valid('json');
      const db = c.var.db;
      const row = await db.form.findUnique({where: {id}, select: {title: true}});
      if (!row) return fail(c, notFound());
      if (confirmTitle.trim() !== row.title.trim()) {
        return fail(
          c,
          new FormsError(422, 'validation_failed', 'Type the form title to confirm', {confirmTitle: ['Type the form title exactly as shown']})
        );
      }
      // ONE statement, in the database: it cascades to versions, responses, events, webhook
      // deliveries, old slugs, prefs, presence and exports. The responses delete trigger keeps the
      // contacts and hourly counts right and puts their signature files in the file trash, which
      // the cleanup job empties a few at a time: no file fan-out and no answer scan in this request.
      await db.form.deleteMany({where: {id}});
      // The title goes in the log: the form itself is gone.
      await logActivity(c, 'form_deleted', ['form', id], {title: titleMeta(row.title)});
      await Promise.all([
        clearPublicSiteCache(),
        clearPublicFormCache(),
        clearSummaryCache(id),
        clearContactsOverview(),
        clearFormsStrip(),
        scheduleFileCleanup(c.req.url),
      ]);
      return c.body(null, 204);
    }
  );
