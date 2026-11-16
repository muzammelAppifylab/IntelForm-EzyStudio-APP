import {Hono} from 'hono';

import {templatePatchInput} from '../../lib/intelform/api-forms';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {deleteSavedTemplate, listTemplates, updateSavedTemplate} from '../intelform/templates/service';
import {zodJson} from '../intelform/templates/validate';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/templates/*` — the Templates page (ported from legacy server/routes/templates.ts):
 *
 *   GET    /       built-in (code) and saved templates + categories   FORM_READ
 *   PATCH  /:id    rename a saved template                            FORM_WRITE
 *   DELETE /:id    delete a saved template                            FORM_WRITE
 *
 * Built-ins answer `403 builtin_template` to PATCH/DELETE. Creating a form from a template
 * (`POST /site-api/forms {templateId|templateSlug}`) and "Save as template"
 * (`POST /site-api/forms/:id/save-as-template`) live in routes/forms.ts, through
 * `loadTemplateSource` / `saveFormAsTemplate` in src/server/intelform/templates/service.ts.
 */
export const templatesRoutes = new Hono()
  .get('/', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    return c.json(await listTemplates(c.var.db));
  })
  .patch(
    '/:id',
    zodJson(templatePatchInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_WRITE),
    withDb,
    async c => {
      const result = await updateSavedTemplate(c.var.db, c.req.param('id'), c.req.valid('json'));
      if (!result.ok) return c.json(problem(result.error, result.message), result.status);
      return c.json({ok: true as const});
    }
  )
  .delete('/:id', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    const result = await deleteSavedTemplate(c.var.db, c.req.param('id'));
    if (!result.ok) return c.json(problem(result.error, result.message), result.status);
    return c.body(null, 204);
  });
