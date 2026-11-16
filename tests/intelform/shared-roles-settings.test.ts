import {describe, expect, it} from 'vitest';

import {ABILITY_OF, canDo, DEFAULT_GRANTS, INTELFORM_CODENAMES, NO_INTELFORM_ABILITIES} from '../../src/lib/intelform/roles';
import {
  appSettingsPatch,
  defaultAppSettings,
  isUploadedFileUrl,
  settingsPatchData,
  settingsView,
  type AppSettingsRow,
} from '../../src/lib/intelform/settings-app';
import {defaultFormSettings, formSettings} from '../../src/lib/intelform/form/settings';
import {abilitiesFor, CATALOGUE, PERMISSIONS} from '../../src/server/permissions';

describe('IntelForm roles mirror the permission catalogue', () => {
  it('uses the same codenames and abilities as src/server/permissions.ts', () => {
    for (const [key, codename] of Object.entries(INTELFORM_CODENAMES)) {
      expect(PERMISSIONS[key as keyof typeof PERMISSIONS]).toBe(codename);
      const entry = CATALOGUE[key as keyof typeof CATALOGUE] as {ability?: string};
      expect(entry.ability).toBe(ABILITY_OF[codename]);
    }
    expect(Object.keys(NO_INTELFORM_ABILITIES).sort()).toEqual(Object.values(ABILITY_OF).sort());
  });

  it('grants each role what the catalogue gives it the first time', () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const expected = Object.values(CATALOGUE)
        .filter(e => (e as {roles?: readonly string[]}).roles?.includes(role) && e.codename.match(/^site:(form|response|contact|intelform):/))
        .map(e => e.codename)
        .sort();
      expect([...(DEFAULT_GRANTS[role] as readonly string[])].sort()).toEqual(expected);
    }
  });

  it('answers the old can(role, permission) from /me abilities', () => {
    const viewer = abilitiesFor(new Set(DEFAULT_GRANTS.viewer as readonly string[]));
    expect(canDo(viewer, 'forms.view')).toBe(true);
    expect(canDo(viewer, 'responses.view')).toBe(true);
    expect(canDo(viewer, 'forms.edit')).toBe(false);
    expect(canDo(viewer, 'responses.delete')).toBe(false);
    expect(canDo(viewer, 'settings.manage')).toBe(false);
    const editor = abilitiesFor(new Set(DEFAULT_GRANTS.editor as readonly string[]));
    expect(canDo(editor, 'templates.edit')).toBe(true);
    expect(canDo(editor, 'settings.manage')).toBe(false);
    const owner = abilitiesFor(new Set(['*']));
    expect(canDo(owner, 'settings.manage')).toBe(true);
    expect(canDo(null, 'forms.view')).toBe(false);
  });
});

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
