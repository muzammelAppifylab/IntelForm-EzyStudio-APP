import {Hono} from 'hono';

import {saveThemeInput} from '../../lib/intelform/api-builder';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {zodJson} from '../intelform/templates/validate';
import {createSavedTheme, deleteSavedTheme, listSavedThemes, THEME_GONE, themePresets} from '../intelform/themes/service';
import {logActivity} from '../activity';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/themes/*` — form design themes (ported from legacy server/routes/themes.ts):
 *
 *   GET    /          saved themes, newest first (max 200)   FORM_READ
 *   GET    /presets   the built-in presets (code)            FORM_READ
 *   POST   /          save the current theme {name, settings} FORM_WRITE
 *   DELETE /:id       delete a saved theme                   FORM_WRITE
 *
 * A form's own theme is saved with the form (PATCH /site-api/forms/:id {theme}).
 */
export const themesRoutes = new Hono()
  .get('/', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    return c.json(await listSavedThemes(c.var.db));
  })
  .get('/presets', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), c => c.json(themePresets()))
  .post('/', zodJson(saveThemeInput), withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    const viewer = c.var.viewer;
    const theme = await createSavedTheme(c.var.db, c.req.valid('json'), {id: viewer.id!, name: viewer.name});
    await logActivity(c, 'theme_saved', ['theme', theme.id], {title: theme.name.trim().slice(0, 120)});
    return c.json(theme, 201);
  })
  .delete('/:id', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    if (!(await deleteSavedTheme(c.var.db, c.req.param('id')))) return c.json(problem('not_found', THEME_GONE), 404);
    await logActivity(c, 'theme_deleted', ['theme', c.req.param('id')]);
    return c.body(null, 204);
  });
