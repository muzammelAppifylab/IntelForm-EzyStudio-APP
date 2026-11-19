import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {type AppSettingsPatch, appSettingsPatch} from '../../lib/intelform/settings-app';
import {checkPatch, loadSettingsView, saveAppSettings} from '../intelform/settings/settings';
import {fieldErrorsOf} from '../intelform/settings/view';
import {logActivity} from '../activity';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/app-settings/*`: IntelForm's App settings (APP_SETTINGS, admins). General,
 * branding, the public site (search, sharing, legal texts), data retention and notification
 * defaults, in the one `intelform_settings` row.
 *
 * What the old app kept here and is now the platform's: email providers (the platform relays
 * emails), file storage (the platform's files) and encrypted secrets (owner secrets). This screen reads the database, never the cache; every save clears the cached settings
 * the public pages read (src/server/intelform/settings).
 *
 *   GET   /            → AppSettingsResponse
 *   PATCH /            {general?, branding?, notifications?, data?, site?, legal?} → AppSettingsResponse
 */

const patchBody = validator('json', (value, c) => {
  const parsed = appSettingsPatch.safeParse(value);
  if (!parsed.success) {
    const {fields, form} = fieldErrorsOf(parsed.error);
    return c.json({...problem('invalid_input', form ?? 'Check the highlighted fields.'), fields}, 422);
  }
  return parsed.data as AppSettingsPatch;
});

export const appSettingsRoutes = new Hono()
  .get('/', withViewer, requireAuth, requirePermission(PERMISSIONS.APP_SETTINGS), withDb, async c => {
    return c.json(await loadSettingsView(c.var.db));
  })
  .patch('/', patchBody, withViewer, requireAuth, requirePermission(PERMISSIONS.APP_SETTINGS), withDb, async c => {
    const patch = c.req.valid('json');
    const db = c.var.db;
    const fields = await checkPatch(db, patch);
    if (Object.keys(fields).length) {
      return c.json({...problem('invalid_input', 'Check the highlighted fields.'), fields}, 422);
    }
    const saved = await saveAppSettings(db, patch, c.var.viewer.id ?? null);
    // Which sections changed, never their values.
    await logActivity(c, 'app_settings_changed', undefined, {sections: Object.keys(patch).sort()});
    return c.json(saved);
  });
