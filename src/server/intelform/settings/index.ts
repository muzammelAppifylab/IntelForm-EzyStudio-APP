/**
 * IntelForm's app settings on the server. Other routes read the settings ONLY through these
 * (cached, cleared on save), never with their own query on `intelform_settings`:
 *
 *   getAppSettings(db)          app name, logo, favicon, time zone, date format, accent, mode,
 *                               default theme, retention, public-site options, hasPrivacy/hasTerms
 *   getLegalText(db, kind)      the Privacy policy / Terms text
 *   getTurnstileKeys(db)        {siteKey, secret, enabled}: both are owner secrets
 *   getEmailDefaults(db)        {appName, fromName, replyTo, enabled} for an email sent now
 *   clearAppSettingsCache()     after ANY write to `intelform_settings`
 */
export {
  clearAppSettingsCache,
  emailEnabled,
  getAppSettings,
  getEmailDefaults,
  getLegalText,
  getTurnstileKeys,
  loadSettingsView,
  saveAppSettings,
  SETTINGS_CACHE_PREFIX,
  TURNSTILE_SECRET_NAME,
  TURNSTILE_SITE_KEY_NAME,
  turnstileSecretSet,
  type CachedAppSettings,
} from './settings';
export {retentionCutoff} from './retention';
export {hitRateLimit} from './rate-limit';
export {APP_SETTINGS_API, type AppSettingsResponse} from './view';
