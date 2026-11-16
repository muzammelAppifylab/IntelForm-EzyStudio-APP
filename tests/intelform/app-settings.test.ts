import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {appSettingsPatch, type AppSettingsRow} from '../../src/lib/intelform/settings-app';
import {cache, setCacheModeForTests} from '../../src/platform/cache';
import type {PrismaClient} from '../../src/platform/db';
import {retentionCutoff} from '../../src/server/intelform/settings/retention';
import {windowStart} from '../../src/server/intelform/settings/rate-limit';
import {
  cachedShape,
  checkPatch,
  defaultSettingsRow,
  getAppSettings,
  getLegalText,
  getTurnstileKeys,
  legalCacheKey,
  saveAppSettings,
  SETTINGS_MAIN_KEY,
  viewOf,
} from '../../src/server/intelform/settings/settings';
import {testTurnstileSecret} from '../../src/server/intelform/settings/turnstile';
import {fieldErrorsOf, formatExample, turnstileTestResult} from '../../src/server/intelform/settings/view';
import {checkImage, storedPath} from '../../src/portal/intelform/settings/upload';
import {env} from '../integration/support/cloudflare-workers';

const MAIN_ROW = {
  appName: 'Acme Forms',
  logoUrl: '/__platform/files/abc/logo.png',
  faviconUrl: null,
  timezone: 'Europe/London',
  dateFormat: 'YYYY-MM-DD',
  accentColor: '#4F46E5',
  defaultMode: 'dark',
  defaultThemeId: 'linen',
  turnstileSiteKey: null,
  retentionDays: 30,
  siteIndexing: true,
  siteDescription: 'Forms by Acme',
  siteOgImage: null,
  contactEmail: 'hello@example.com',
  emailFromName: null,
  hasPrivacy: true,
  hasTerms: false,
};

/** A stand-in Site Database with only what the settings code calls. */
function fakeDb(row: AppSettingsRow = {...defaultSettingsRow(), privacyText: 'Be nice.'}) {
  const state = {row: {...row}};
  const db = {
    $queryRaw: vi.fn(async () => [{...MAIN_ROW, appName: state.row.appName}]),
    intelformSettings: {
      findUnique: vi.fn(async ({select}: {select: Record<string, boolean>}) =>
        Object.fromEntries(Object.keys(select).map(k => [k, state.row[k as keyof AppSettingsRow]]))
      ),
      upsert: vi.fn(async ({update}: {update: Partial<AppSettingsRow>}) => {
        const {updatedById: _u, ...data} = update as Partial<AppSettingsRow> & {updatedById?: number};
        state.row = {...state.row, ...data};
        return state.row;
      }),
    },
    theme: {
      findUnique: vi.fn(async ({where}: {where: {id: string}}) => (where.id === '11111111-1111-4111-8111-111111111111' ? {id: where.id} : null)),
    },
  };
  return {db: db as unknown as PrismaClient, mock: db, state};
}

beforeEach(() => {
  setCacheModeForTests('memory');
  delete env.TURNSTILE_SECRET_KEY;
  delete env.TURNSTILE_SITE_KEY;
});

afterEach(async () => {
  await cache.delPrefix('');
  setCacheModeForTests(null);
  vi.unstubAllGlobals();
});

describe('app settings: cached reads', () => {
  it('reads the main settings once, then from the cache', async () => {
    const {db, mock} = fakeDb();
    const first = await getAppSettings(db);
    const second = await getAppSettings(db);
    expect(first).toEqual(second);
    expect(first.appName).toBe('IntelForm');
    expect(first.timezone).toBe('Europe/London');
    expect(first.hasPrivacy).toBe(true);
    expect(mock.$queryRaw).toHaveBeenCalledTimes(1);
    // No reply-to address and no legal text in the shared key.
    expect(JSON.stringify(await cache.get(SETTINGS_MAIN_KEY))).not.toMatch(/replyTo|privacyText|termsText/);
  });

  it('caches each legal text under its own key', async () => {
    const {db, mock} = fakeDb();
    expect(await getLegalText(db, 'privacy')).toBe('Be nice.');
    expect(await getLegalText(db, 'privacy')).toBe('Be nice.');
    expect(await getLegalText(db, 'terms')).toBe('');
    expect(mock.intelformSettings.findUnique).toHaveBeenCalledTimes(2);
    expect(await cache.get(legalCacheKey('privacy'))).toBe('Be nice.');
  });

  it('a save clears every cached key, so the next read shows the change', async () => {
    const {db, mock, state} = fakeDb();
    await getAppSettings(db);
    await getLegalText(db, 'privacy');
    const view = await saveAppSettings(db, {general: {appName: 'Renamed'}, legal: {privacy: 'New text'}}, 7);
    expect(view.general.appName).toBe('Renamed');
    expect(state.row.privacyText).toBe('New text');
    expect(mock.intelformSettings.upsert.mock.calls[0]![0]).toMatchObject({where: {id: 1}, update: {appName: 'Renamed', privacyText: 'New text', updatedById: 7}});
    expect(await cache.get(SETTINGS_MAIN_KEY)).toBeNull();
    expect(await cache.get(legalCacheKey('privacy'))).toBeNull();
    expect((await getAppSettings(db)).appName).toBe('Renamed');
    expect(await getLegalText(db, 'privacy')).toBe('New text');
  });

  it('falls back to safe values for anything outside the allowed sets', () => {
    const shaped = cachedShape({...MAIN_ROW, dateFormat: 'nonsense', defaultMode: 'sepia'});
    expect(shaped.dateFormat).toBe('DD/MM/YYYY');
    expect(shaped.defaultMode).toBe('system');
  });
});

describe('app settings: Turnstile keys are owner secrets', () => {
  it('the view reports presence only, never a value', () => {
    env.TURNSTILE_SECRET_KEY = '0x4AAAAAAA-secret';
    const view = viewOf({...defaultSettingsRow(), turnstileSiteKey: '0xOLD'});
    expect(view.spam).toEqual({turnstileSiteKey: null, turnstileSiteKeySet: true, turnstileSecretSet: true});
    expect(JSON.stringify(view)).not.toContain('0x4AAAAAAA-secret');
    expect(JSON.stringify(view)).not.toContain('0xOLD');
  });

  it('reports missing keys', () => {
    expect(viewOf(defaultSettingsRow()).spam).toEqual({turnstileSiteKey: null, turnstileSiteKeySet: false, turnstileSecretSet: false});
  });

  it('forms are checked only when both keys are present; the owner secret wins', async () => {
    const {db} = fakeDb();
    expect(await getTurnstileKeys(db)).toEqual({siteKey: null, secret: null, enabled: false});
    env.TURNSTILE_SITE_KEY = '0xSITE';
    expect((await getTurnstileKeys(db)).enabled).toBe(false);
    env.TURNSTILE_SECRET_KEY = '0xSECRET';
    expect(await getTurnstileKeys(db)).toEqual({siteKey: '0xSITE', secret: '0xSECRET', enabled: true});
  });

  it('a patch may not save a site key', async () => {
    const {db} = fakeDb();
    expect(await checkPatch(db, {spam: {turnstileSiteKey: '0xNEW'}})).toHaveProperty('turnstileSiteKey');
    expect(await checkPatch(db, {spam: {turnstileSiteKey: null}})).toEqual({});
  });

  it('interprets the siteverify answer', async () => {
    expect(turnstileTestResult({success: false, 'error-codes': ['invalid-input-secret']}).ok).toBe(false);
    expect(turnstileTestResult({success: false, 'error-codes': ['invalid-input-response']})).toEqual({ok: true, message: 'Cloudflare accepted the secret key.'});
    expect(turnstileTestResult(null).ok).toBe(false);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({success: false, 'error-codes': ['invalid-input-response']})));
    expect((await testTurnstileSecret('0xSECRET', fetcher as unknown as typeof fetch)).ok).toBe(true);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.secret).toBe('0xSECRET');
    const offline = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect((await testTurnstileSecret('0xSECRET', offline as unknown as typeof fetch)).ok).toBe(false);
  });
});

describe('app settings: patch validation', () => {
  it('maps zod issues to the input names', () => {
    const parsed = appSettingsPatch.safeParse({general: {appName: '', timezone: 'Mars/Base'}, branding: {accentColor: 'blue'}});
    expect(parsed.success).toBe(false);
    const {fields} = fieldErrorsOf(parsed.error!);
    expect(fields).toMatchObject({appName: 'Enter an app name', timezone: 'Pick a timezone from the list', accentColor: 'Use a hex colour like #4F46E5'});
  });

  it('refuses images stored anywhere but this site', () => {
    expect(appSettingsPatch.safeParse({general: {logoUrl: 'https://evil.example/x.png'}}).success).toBe(false);
    expect(appSettingsPatch.safeParse({general: {logoUrl: '/__platform/files/abc_1/logo.png'}}).success).toBe(true);
  });

  it('checks the default theme: a preset, or a saved theme that still exists', async () => {
    const {db} = fakeDb();
    expect(await checkPatch(db, {branding: {defaultThemeId: 'linen'}})).toEqual({});
    expect(await checkPatch(db, {branding: {defaultThemeId: 'not-a-theme'}})).toHaveProperty('defaultThemeId');
    expect(await checkPatch(db, {branding: {defaultThemeId: '11111111-1111-4111-8111-111111111111'}})).toEqual({});
    expect(await checkPatch(db, {branding: {defaultThemeId: '22222222-2222-4222-8222-222222222222'}})).toHaveProperty('defaultThemeId');
    expect(await checkPatch(db, {branding: {defaultThemeId: null}})).toEqual({});
  });
});

describe('app settings: helpers', () => {
  it('retention cutoff', () => {
    const now = new Date('2026-11-16T00:00:00Z');
    expect(retentionCutoff(null, now)).toBeNull();
    expect(retentionCutoff(0, now)).toBeNull();
    expect(retentionCutoff(30, now)?.toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });

  it('rate-limit windows are fixed', () => {
    expect(windowStart(Date.parse('2026-11-16T10:07:30Z'), 600).toISOString()).toBe('2026-11-16T10:00:00.000Z');
  });

  it('date format examples', () => {
    const d = new Date(2026, 0, 5);
    expect(formatExample('DD/MM/YYYY', d)).toBe('05/01/2026');
    expect(formatExample('MM/DD/YYYY', d)).toBe('01/05/2026');
    expect(formatExample('YYYY-MM-DD', d)).toBe('2026-01-05');
    expect(formatExample('D MMM YYYY', d)).toBe('5 Jan 2026');
  });

  it('upload paths and checks', () => {
    const origin = 'https://forms.example.com';
    expect(storedPath('/__platform/files/abc/logo.png', origin)).toBe('/__platform/files/abc/logo.png');
    expect(storedPath('https://forms.example.com/__platform/files/abc/logo.png', origin)).toBe('/__platform/files/abc/logo.png');
    expect(storedPath('https://cdn.example.net/__platform/files/abc/logo.png', origin)).toBeNull();
    expect(storedPath('/uploads/logo.png', origin)).toBeNull();
    expect(checkImage({type: 'image/svg+xml', size: 10}, 'logo')).toBeNull();
    expect(checkImage({type: 'image/svg+xml', size: 10}, 'og')).not.toBeNull();
    expect(checkImage({type: 'image/png', size: 6 * 1024 * 1024}, 'favicon')).toBe('Choose an image under 5 MB.');
  });
});
