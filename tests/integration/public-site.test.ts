import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {setCacheModeForTests} from '../../src/platform/cache';
import {app} from '../../src/server/app';
import {clearPublicSiteCache} from '../../src/server/intelform/public-site/data';
import {clearAppSettingsCache} from '../../src/server/intelform/settings';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The public site's data routes against a real Postgres (legacy server/routes/public-site.test.ts):
 * which forms are listed, until when, and what Settings, Public site puts on the pages. Forms are
 * written straight to the tables, so this tests only the public reads.
 */

const definition = (title: string, minutes: number | null) => ({
  layout: 'one_at_a_time',
  startScreen: {enabled: true, title, button: 'Start', minutes},
  fields: [{id: 'f_name1', type: 'short_text', label: 'Your name', required: false, props: {}}],
  endScreen: {title: 'Thanks', message: '', redirectUrl: null},
});

/** A form, published when `live`, listed on the homepage unless told otherwise. */
async function form(slug: string, title: string, options: {status?: string; listed?: boolean; settings?: Record<string, unknown>} = {}) {
  const {status = 'live', listed = true} = options;
  const settings = {closed: false, closeAt: null, noindex: true, showOnFrontPage: listed, frontPageDescription: `About ${title}`, ...options.settings};
  const created = await db.form.create({data: {slug, title, status, draft: definition(title, 3), settings, theme: {}}, select: {id: true}});
  if (status !== 'draft') {
    const version = await db.formVersion.create({
      data: {formId: created.id, version: 1, definition: definition(title, 3), theme: {}},
      select: {id: true},
    });
    await db.form.update({where: {id: created.id}, data: {publishedVersionId: version.id}});
  }
  return created.id;
}

async function settingsRow(data: Record<string, unknown>) {
  await db.intelformSettings.upsert({where: {id: 1}, create: {id: 1, ...data}, update: data});
  await clearAppSettingsCache();
}

describe.skipIf(!DATABASE_URL)('public site (integration, real Postgres)', () => {
  const visitor = new Browser(app);

  beforeAll(() => {
    configureEnv();
    setCacheModeForTests('memory');
  });
  afterAll(async () => {
    await db.$executeRawUnsafe('DELETE FROM "intelform_settings"');
    await db.$executeRawUnsafe('INSERT INTO "intelform_settings" ("id") VALUES (1)');
    setCacheModeForTests(null);
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    await db.$executeRawUnsafe('DELETE FROM "intelform_settings"');
    await db.$executeRawUnsafe('INSERT INTO "intelform_settings" ("id") VALUES (1)');
    await clearAppSettingsCache();
    await clearPublicSiteCache();
  });

  it('lists Live forms turned on in the Share tab, by title, until they close', async () => {
    await form('beta', 'Beta feedback');
    await form('alpha', 'Alpha survey');
    await form('draft-only', 'Draft only', {status: 'draft'});
    await form('not-listed', 'Not listed', {listed: false});
    await form('closing', 'Closing soon', {settings: {closeAt: '2020-01-01T00:00:00Z'}});

    const home = await visitor.get('/site-api/public-site/home');
    expect(home.status).toBe(200);
    expect(home.json).toMatchObject({appName: 'IntelForm', indexing: false, hasPrivacy: false, hasTerms: false, contactEmail: ''});
    expect(home.json.forms).toEqual([
      {title: 'Alpha survey', slug: 'alpha', description: 'About Alpha survey', minutes: 3},
      {title: 'Beta feedback', slug: 'beta', description: 'About Beta feedback', minutes: 3},
    ]);

    // Closing one (as the forms route does) and clearing the cache: gone on the next read.
    await db.$executeRaw`UPDATE forms SET settings = settings || '{"closed": true}'::jsonb WHERE slug = 'beta'`;
    await clearPublicSiteCache();
    const after = await visitor.get('/site-api/public-site/forms?search=survey');
    expect(after.json).toMatchObject({total: 1, next: null, forms: [{slug: 'alpha'}]});
  });

  it('takes search and legal texts from Settings', async () => {
    await settingsRow({siteIndexing: true, siteDescription: 'Short surveys.', contactEmail: 'hello@example.com', privacyText: 'We keep little.\n\nAsk us anything.'});
    expect((await visitor.get('/site-api/public-site/home')).json).toMatchObject({
      description: 'Short surveys.',
      indexing: true,
      contactEmail: 'hello@example.com',
      hasPrivacy: true,
      hasTerms: false,
    });
    const legal = await visitor.get('/site-api/public-site/legal/privacy');
    expect(legal.json).toMatchObject({kind: 'privacy', title: 'Privacy policy', text: 'We keep little.\n\nAsk us anything.', indexing: true});
    expect((await visitor.get('/site-api/public-site/legal/cookies')).status).toBe(404);
  });

  it('the sitemap lists open forms that allow search engines', async () => {
    await form('indexed', 'Indexed', {listed: false, settings: {noindex: false}});
    await form('hidden', 'Hidden');
    const sitemap = await visitor.get('/site-api/public-site/sitemap');
    expect(sitemap.status).toBe(200);
    expect((sitemap.json.forms as {slug: string}[]).map(f => f.slug)).toEqual(['indexed']);
  });

  it('app info carries no secrets', async () => {
    const info = await visitor.get('/site-api/public-site/app');
    expect(Object.keys(info.json).sort()).toEqual(['accentColor', 'appName', 'dateFormat', 'defaultMode', 'emailEnabled', 'faviconUrl', 'logoUrl']);
  });
});
