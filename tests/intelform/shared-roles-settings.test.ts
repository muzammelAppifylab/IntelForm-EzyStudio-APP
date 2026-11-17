import {describe, expect, it} from 'vitest';

import {
  appSettingsPatch,
  defaultAppSettings,
  isUploadedFileUrl,
  settingsPatchData,
  settingsView,
  type AppSettingsRow,
} from '../../src/lib/intelform/settings-app';
import {defaultFormSettings, formSettings} from '../../src/lib/intelform/form/settings';

describe('app settings', () => {
  const row: AppSettingsRow = {
    appName: 'IntelForm',
    logoUrl: null,
    faviconUrl: null,
    timezone: 'UTC',
    dateFormat: 'nonsense',
    accentColor: null,
    defaultMode: 'system',
    defaultThemeId: null,
    turnstileSiteKey: null,
    retentionDays: null,
    siteIndexing: false,
    siteDescription: '',
    siteOgImage: null,
    contactEmail: '',
    privacyText: '',
    termsText: '',
    emailFromName: null,
    emailReplyTo: null,
  };

  it('accepts only files stored on this site as images', () => {
    expect(isUploadedFileUrl('/__platform/files/abc_123/logo.png')).toBe(true);
    expect(isUploadedFileUrl('/__platform/files/abc/my%20logo.svg')).toBe(true);
    expect(isUploadedFileUrl('https://evil.example/logo.png')).toBe(false);
    expect(isUploadedFileUrl('/__platform/files/../x/y.png')).toBe(false);
    expect(isUploadedFileUrl('/__platform/files/abc/a/b.png')).toBe(false);
    expect(appSettingsPatch.safeParse({general: {logoUrl: 'https://x.example/a.png'}}).success).toBe(false);
  });

  it('maps a PATCH to the columns it changes, and the row back to the view', () => {
    const patch = appSettingsPatch.parse({
      general: {appName: '  Acme  '},
      notifications: {fromName: '', replyTo: 'Team@Example.com'},
      data: {retentionDays: '30'},
      site: {indexing: true},
    });
    expect(settingsPatchData(patch)).toEqual({
      appName: 'Acme',
      emailFromName: null,
      emailReplyTo: 'team@example.com',
      retentionDays: 30,
      siteIndexing: true,
    });
    const view = settingsView(row, {turnstileSecretSet: false, emailEnabled: true});
    expect(view.general.dateFormat).toBe('DD/MM/YYYY');
    expect(view.notifications.enabled).toBe(true);
    expect(view.general).toEqual(defaultAppSettings().general);
  });

  it('refuses bad values', () => {
    expect(appSettingsPatch.safeParse({branding: {accentColor: 'red'}}).success).toBe(false);
    expect(appSettingsPatch.safeParse({general: {timezone: 'Mars/Base'}}).success).toBe(false);
    expect(appSettingsPatch.safeParse({data: {retentionDays: 0}}).success).toBe(false);
    expect(appSettingsPatch.safeParse({general: {appName: 'two\nlines'}}).success).toBe(false);
  });
});

describe('form settings', () => {
  it('stores notification recipients as users.id numbers', () => {
    expect(formSettings.parse({notifyRecipients: [1, 7]}).notifyRecipients).toEqual([1, 7]);
    expect(() => formSettings.parse({notifyRecipients: ['8f1c2d3e-0000-4000-8000-000000000000']})).toThrow();
    expect(defaultFormSettings().notifyRecipients).toEqual([]);
  });
});
