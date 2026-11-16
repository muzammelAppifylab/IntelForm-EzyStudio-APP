import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {setCacheModeForTests} from '../../src/platform/cache';
import {app} from '../../src/server/app';
import {configureEnv, DATABASE_URL, db, ownerSignedIn, resetDatabase, signedIn, userId} from './support/harness';

/**
 * App settings against a real Postgres: only admins (site:intelform:settings) get in, a save
 * shows on the next read (database and the cached public read alike), and bad input comes
 * back as field errors. The settings row is put back to its defaults after each test.
 */
async function restoreDefaults() {
  await db.$executeRawUnsafe('DELETE FROM "intelform_settings"');
  await db.$executeRawUnsafe('INSERT INTO "intelform_settings" ("id") VALUES (1)');
}

describe.skipIf(!DATABASE_URL)('app settings (integration, real Postgres)', () => {
  beforeAll(() => {
    configureEnv();
    setCacheModeForTests('memory');
  });
  afterAll(async () => {
    await restoreDefaults();
    setCacheModeForTests(null);
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    await restoreDefaults();
  });

  it('admins read and save; the change shows on the next read', async () => {
    const owner = await ownerSignedIn(app);
    const before = await owner.get('/site-api/app-settings');
    expect(before.status).toBe(200);
    expect((before.json.general as {appName: string}).appName).toBe('IntelForm');
    expect(before.json.spam).toEqual({turnstileSiteKey: null, turnstileSiteKeySet: false, turnstileSecretSet: false});

    const saved = await owner.request('PATCH', '/site-api/app-settings', {general: {appName: 'Acme Forms'}, data: {retentionDays: 90}});
    expect(saved.status).toBe(200);
    expect((saved.json.general as {appName: string}).appName).toBe('Acme Forms');

    const after = await owner.get('/site-api/app-settings');
    expect((after.json.general as {appName: string}).appName).toBe('Acme Forms');
    expect((after.json.data as {retentionDays: number}).retentionDays).toBe(90);
  });

  it('refuses bad input with field errors, and a site key (owner secrets only)', async () => {
    const owner = await ownerSignedIn(app);
    const bad = await owner.request('PATCH', '/site-api/app-settings', {general: {appName: ''}, branding: {accentColor: 'blue'}});
    expect(bad.status).toBe(422);
    expect(bad.json.fields).toMatchObject({appName: 'Enter an app name', accentColor: 'Use a hex colour like #4F46E5'});
    const key = await owner.request('PATCH', '/site-api/app-settings', {spam: {turnstileSiteKey: '0xABC'}});
    expect(key.status).toBe(422);
    expect(key.json.fields).toHaveProperty('turnstileSiteKey');
    const theme = await owner.request('PATCH', '/site-api/app-settings', {branding: {defaultThemeId: '22222222-2222-4222-8222-222222222222'}});
    expect(theme.status).toBe(422);
  });

  it('members and editors get 403; guests 401', async () => {
    const member = await signedIn(app, 'member@example.com');
    expect((await member.get('/site-api/app-settings')).status).toBe(403);

    const editor = await signedIn(app, 'editor@example.com');
    const id = await userId('editor@example.com');
    const role = await db.role.findUniqueOrThrow({where: {slug: 'editor'}, select: {id: true}});
    await db.userRole.deleteMany({where: {userId: id}});
    await db.userRole.create({data: {userId: id, roleId: role.id}});
    expect((await editor.request('PATCH', '/site-api/app-settings', {general: {appName: 'Nope'}})).status).toBe(403);

    const {Browser} = await import('./support/harness');
    expect((await new Browser(app).get('/site-api/app-settings')).status).toBe(401);
  });

  it('the Turnstile test says what to add when the secret is missing', async () => {
    const owner = await ownerSignedIn(app);
    const res = await owner.post('/site-api/app-settings/spam/test');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ok: false, message: 'Add the TURNSTILE_SECRET_KEY owner secret first.'});
  });
});
