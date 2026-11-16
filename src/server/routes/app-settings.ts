import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {type AppSettingsPatch, appSettingsPatch, type SettingsTestResult} from '../../lib/intelform/settings-app';
import {checkPatch, loadSettingsView, saveAppSettings, TURNSTILE_SECRET_NAME} from '../intelform/settings/settings';
import {hitRateLimit} from '../intelform/settings/rate-limit';
import {testTurnstileSecret} from '../intelform/settings/turnstile';
import {fieldErrorsOf} from '../intelform/settings/view';
import {config} from '../../platform/config';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/app-settings/*`: IntelForm's App settings (APP_SETTINGS, admins). General,
 * branding, the public site (search, sharing, legal texts), data retention and notification
 * defaults, in the one `intelform_settings` row.
 *
 * What the old app kept here and is now the platform's: email providers (the platform relays
 * emails), file storage (the platform's files) and encrypted secrets (owner secrets: the
 * Turnstile keys are `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`, reported only as present or
 * not). This screen reads the database, never the cache; every save clears the cached settings
 * the public pages read (src/server/intelform/settings).
 *
 *   GET   /            → AppSettingsResponse
 *   PATCH /            {general?, branding?, notifications?, data?, site?, legal?} → AppSettingsResponse
 *   POST  /spam/test   → SettingsTestResult (checks TURNSTILE_SECRET_KEY with Cloudflare)
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
    return c.json(await saveAppSettings(db, patch, c.var.viewer.id ?? null));
  })
  .post('/spam/test', withViewer, requireAuth, requirePermission(PERMISSIONS.APP_SETTINGS), withDb, async c => {
    if (!(await hitRateLimit(c.var.db, `settings-test:${c.var.viewer.id}`, 20, 10 * 60))) {
      return c.json(problem('rate_limited', 'Too many tests. Wait a few minutes and try again.'), 429);
    }
    const secret = config.ownerSecret(TURNSTILE_SECRET_NAME);
    if (!secret) {
      return c.json<SettingsTestResult>({ok: false, message: 'Add the TURNSTILE_SECRET_KEY owner secret first.'});
    }
    return c.json<SettingsTestResult>(await testTurnstileSecret(secret));
  });
