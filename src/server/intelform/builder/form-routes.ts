import {Hono} from 'hono';

import {formPatchInput, type FormPatchResponse, type PublishResponse} from '../../../lib/intelform/api-forms';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../../platform/guards';
import {IdempotencyConflict, idempotencyKeyOf, idempotent} from '../../../platform/idempotency';
import {PERMISSIONS} from '../../permissions';
import {clearPublicSiteCache} from '../public-site/data';
import {clearPublicFormCache} from '../respondent/cache';
import {clearSummaryCache} from '../responses/summary';
import {ifMatchRevision} from './draft';
import {builderError, GONE, uuidOrNull} from './errors';
import {publishInTx, type VersionDetail, type VersionsResponse} from './publish';
import {preparePatch, saveFormPatch} from './save';
import {zodJson} from './validate';

const notFound = problem('not_found', GONE);

/**
 * A form's draft lifecycle, mounted at `/site-api/forms` (and also at `/site-api/builder/forms`):
 *
 *   PATCH /:id                      autosave (If-Match "<revision>"; last save wins)  FORM_WRITE
 *   POST  /:id/publish              new version from the draft (Idempotency-Key ok)   FORM_WRITE
 *   GET   /:id/versions             published versions, newest first                  FORM_READ
 *   GET   /:id/versions/:version    one version's definition and theme                FORM_READ
 *
 * The forms list, create, read, duplicate, close/reopen and delete are routes/forms.ts.
 */
export const formDraftRoutes = new Hono()
  .patch(
    '/:id',
    zodJson(formPatchInput, 'The form couldn’t be saved: check the highlighted fields.'),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_WRITE),
    withDb,
    async c => {
      const formId = uuidOrNull(c.req.param('id'));
      if (!formId) return c.json(notFound, 404);
      try {
        const patch = await preparePatch(c.req.valid('json'));
        const result = await saveFormPatch(c.var.db, {
          formId,
          patch,
          expected: ifMatchRevision(c.req.header('if-match')),
          userId: c.var.viewer.id!,
        });
        // The title, slug or settings may have changed what the public site and the form page show.
        if (patch.title !== undefined || patch.slug !== undefined || patch.settingsPatch !== undefined || patch.passwordHash !== undefined) {
          if (result.status === 'live') await clearPublicSiteCache();
          if (result.status !== 'draft') await clearPublicFormCache();
        }
        return c.json<FormPatchResponse>(result);
      } catch (err) {
        return builderError(c, err);
      }
    }
  )

  .post('/:id/publish', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    if (!formId) return c.json(notFound, 404);
    const userId = c.var.viewer.id!;
    const key = idempotencyKeyOf(c.req.raw);
    try {
      const result = key
        ? (
            await idempotent(c.var.db, {scope: `form-publish:${userId}`, key, request: {formId}}, tx =>
              publishInTx(tx, formId, userId)
            )
          ).value
        : await c.var.db.$transaction(tx => publishInTx(tx, formId, userId));
      await Promise.all([clearPublicSiteCache(), clearPublicFormCache(), clearSummaryCache(formId)]);
      return c.json<PublishResponse>(result);
    } catch (err) {
      if (err instanceof IdempotencyConflict) return c.json(problem(err.code, 'Reload the page and publish again.'), 409);
      return builderError(c, err);
    }
  })

  .get('/:id/versions', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    if (!formId) return c.json(notFound, 404);
    const form = await c.var.db.form.findUnique({
      where: {id: formId},
      select: {
        publishedVersionId: true,
        versions: {
          orderBy: {version: 'desc'},
          take: 100,
          select: {id: true, version: true, publishedAt: true, publishedBy: {select: {id: true, name: true}}},
        },
      },
    });
    if (!form) return c.json(notFound, 404);
    return c.json<VersionsResponse>({
      versions: form.versions.map(v => ({
        version: v.version,
        publishedAt: v.publishedAt.toISOString(),
        publishedBy: v.publishedBy ? {id: v.publishedBy.id, name: v.publishedBy.name} : null,
        live: v.id === form.publishedVersionId,
      })),
    });
  })

  .get('/:id/versions/:version', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    const version = Number(c.req.param('version'));
    if (!formId || !Number.isInteger(version) || version < 1 || version > 1_000_000) {
      return c.json(problem('not_found', 'That version doesn’t exist.'), 404);
    }
    const row = await c.var.db.formVersion.findUnique({
      where: {formId_version: {formId, version}},
      select: {version: true, publishedAt: true, definition: true, theme: true},
    });
    if (!row) return c.json(problem('not_found', 'That version doesn’t exist.'), 404);
    return c.json<VersionDetail>({
      version: row.version,
      publishedAt: row.publishedAt.toISOString(),
      definition: row.definition,
      theme: row.theme,
    });
  });
