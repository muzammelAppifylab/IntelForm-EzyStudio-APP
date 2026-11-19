import {afterEach, describe, expect, it, vi} from 'vitest';

import {setCacheModeForTests} from '../../src/platform/cache';
import {formsCountText, formHref} from '../../src/server/intelform/public-site/common';
import {clearPublicSiteCache, listedForms, publicSettingsOf} from '../../src/server/intelform/public-site/data';
import {
  formsPage,
  isLegalKind,
  listedFormFromRow,
  normalizeSearch,
  openNow,
  publicAppInfo,
  publicHome,
  publicLegal,
  sitemapForms,
  sitemapPaths,
} from '../../src/server/intelform/public-site/shape';
import {publicSiteRoutes} from '../../src/server/routes/public-site';

/** Unit tests for the public site's data (legacy server/routes/public-site.test.ts, without a database). */

/** The app settings' cached shape (src/server/intelform/settings getAppSettings). */
const cached = {
  appName: 'Acme',
  logoUrl: '/__platform/files/abc/logo.png',
  faviconUrl: null,
  timezone: 'UTC',
  dateFormat: 'YYYY-MM-DD' as const,
  accentColor: '#4F46E5',
  defaultMode: 'dark' as const,
  defaultThemeId: null,
  retentionDays: null,
  siteIndexing: true,
  siteDescription: 'Short surveys.',
  siteOgImage: '/__platform/files/og1/og.png',
  contactEmail: 'hello@example.com',
  emailFromName: null,
  hasPrivacy: true,
  hasTerms: false,
};
const settings = publicSettingsOf(cached);

const card = (title: string, slug: string, description = '') => ({title, slug, description, minutes: null});

describe('public settings', () => {
  it('takes only the public parts of the app settings', () => {
    expect(settings).toEqual({
      appName: 'Acme',
      logoUrl: '/__platform/files/abc/logo.png',
      faviconUrl: null,
      accentColor: '#4F46E5',
      defaultMode: 'dark',
      dateFormat: 'YYYY-MM-DD',
      indexing: true,
      description: 'Short surveys.',
      ogImage: '/__platform/files/og1/og.png',
      contactEmail: 'hello@example.com',
      hasPrivacy: true,
      hasTerms: false,
    });
  });

  it('builds the home answer field by field', () => {
    const forms = [card('Alpha survey', 'alpha', 'About Alpha')];
    expect(publicHome(settings, forms)).toEqual({
      appName: 'Acme',
      logoUrl: '/__platform/files/abc/logo.png',
      forms,
      description: 'Short surveys.',
      ogImage: '/__platform/files/og1/og.png',
      contactEmail: 'hello@example.com',
      indexing: true,
      hasPrivacy: true,
      hasTerms: false,
    });
  });

  it('app info checks the accent, mode and date format it hands out', () => {
    expect(publicAppInfo(settings, true)).toEqual({
      appName: 'Acme',
      logoUrl: '/__platform/files/abc/logo.png',
      emailEnabled: true,
      faviconUrl: null,
      accentColor: '#4F46E5',
      defaultMode: 'dark',
      dateFormat: 'YYYY-MM-DD',
    });
    const odd = {...settings, accentColor: 'red', defaultMode: 'sepia', dateFormat: 'DD.MM'};
    expect(publicAppInfo(odd, false)).toMatchObject({accentColor: null, defaultMode: 'system', dateFormat: 'DD/MM/YYYY', emailEnabled: false});
  });
});

describe('listed forms', () => {
  it('maps a card row: description defaults to empty, minutes only when positive, close date as ISO', () => {
    expect(listedFormFromRow({title: 'A', slug: 'a', description: null, minutes: 3, close_at: new Date('2030-01-01T00:00:00Z')})).toEqual({
      title: 'A',
      slug: 'a',
      description: '',
      minutes: 3,
      closeAt: '2030-01-01T00:00:00.000Z',
    });
    expect(listedFormFromRow({title: 'B', slug: 'b', description: 'x', minutes: 0, close_at: null})).toMatchObject({minutes: null, closeAt: null});
    expect(listedFormFromRow({title: 'C', slug: 'c', description: 'x', minutes: null, close_at: 'not a date'})).toMatchObject({closeAt: null});
  });

  it('drops a form whose close date passed since the list was cached', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const forms = [
      {...card('Open', 'open'), closeAt: null},
      {...card('Later', 'later'), closeAt: '2026-06-02T00:00:00.000Z'},
      {...card('Gone', 'gone'), closeAt: '2026-06-01T11:59:59.000Z'},
    ];
    expect(openNow(forms, now).map(f => f.slug)).toEqual(['open', 'later']);
    // The card leaves the close date out.
    expect(openNow(forms, now)[1]).toEqual(card('Later', 'later'));
  });
});

describe('the /forms/ list page', () => {
  const forms = Array.from({length: 30}, (_, i) => card(`Form ${String(i + 1).padStart(2, '0')}`, `form-${i + 1}`, i === 4 ? 'Book a visit' : ''));

  it('pages by slug, 24 at a time', () => {
    const first = formsPage(forms, {indexing: true});
    expect(first.forms).toHaveLength(24);
    expect(first.next).toBe('form-24');
    expect(first.total).toBe(30);
    expect(first.indexing).toBe(true);
    const second = formsPage(forms, {after: first.next, indexing: true});
    expect(second.forms.map(f => f.slug)).toEqual(['form-25', 'form-26', 'form-27', 'form-28', 'form-29', 'form-30']);
    expect(second.next).toBeNull();
  });

  it('searches title and description, any case, and keeps the unfiltered total', () => {
    const page = formsPage(forms, {search: '  BOOK  a ', indexing: false});
    expect(page.forms.map(f => f.slug)).toEqual(['form-5']);
    expect(page.total).toBe(30);
    expect(page.next).toBeNull();
    expect(formsPage(forms, {search: 'nothing like this', indexing: false}).forms).toEqual([]);
  });

  it('a cursor that is gone ends the list instead of starting over', () => {
    expect(formsPage(forms, {after: 'closed-meanwhile', indexing: true})).toMatchObject({forms: [], next: null});
  });

  it('bounds the search', () => {
    expect(normalizeSearch('x'.repeat(200))).toHaveLength(80);
    expect(normalizeSearch(null)).toBe('');
  });

  it('says how many forms are open', () => {
    expect(formsCountText(0)).toBe('No forms are listed here right now.');
    expect(formsCountText(1)).toBe('1 open form.');
    expect(formsCountText(3)).toBe('3 open forms.');
  });

  it('links a form to its public page', () => {
    expect(formHref('contact-us')).toBe('/f/contact-us/');
  });
});

describe('legal pages', () => {
  it('knows only privacy and terms', () => {
    expect(isLegalKind('privacy')).toBe(true);
    expect(isLegalKind('terms')).toBe(true);
    expect(isLegalKind('cookies')).toBe(false);
    expect(publicLegal('privacy', 'Acme', 'We keep little.', false)).toEqual({
      kind: 'privacy',
      title: 'Privacy policy',
      appName: 'Acme',
      text: 'We keep little.',
      indexing: false,
    });
  });
});

describe('sitemap', () => {
  const pages = ['/', '/blog/', '/forms/', '/privacy/', '/terms/'];

  it('lists the public site only while it may be indexed, and legal pages once written', () => {
    const data = {indexing: true, hasPrivacy: true, hasTerms: false, forms: [{slug: 'contact-us', lastmod: '2026-01-02T00:00:00.000Z'}]};
    expect(sitemapPaths(pages, data)).toEqual([
      {path: '/'},
      {path: '/blog/'},
      {path: '/forms/'},
      {path: '/privacy/'},
      {path: '/f/contact-us/', lastmod: '2026-01-02T00:00:00.000Z'},
    ]);
    expect(sitemapPaths(pages, {...data, indexing: false}).map(e => e.path)).toEqual(['/blog/', '/f/contact-us/']);
    // The database could not be read: the site's own pages are left out, other pages stay.
    expect(sitemapPaths(pages, null)).toEqual([{path: '/blog/'}]);
  });

  it('keeps only rows with a valid date', () => {
    expect(sitemapForms([{slug: 'a', published_at: new Date('2026-01-01T00:00:00Z')}, {slug: 'b', published_at: 'nope'}])).toEqual([
      {slug: 'a', lastmod: '2026-01-01T00:00:00.000Z'},
    ]);
  });
});

describe('site cache', () => {
  afterEach(() => setCacheModeForTests(null));

  it('serves the forms list from the cache until cleared', async () => {
    setCacheModeForTests('memory');
    await clearPublicSiteCache();
    const queryRaw = vi.fn(async () => [{title: 'A', slug: 'a', description: null, minutes: 2, close_at: null}]);
    const db = {$queryRaw: queryRaw} as never;

    expect(await listedForms(db)).toEqual([{title: 'A', slug: 'a', description: '', minutes: 2, closeAt: null}]);
    expect(await listedForms(db)).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    await clearPublicSiteCache();
    await listedForms(db);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('routes: input checks before any database', () => {
  it('404s an unknown legal page and 422s a long search or a bad cursor', async () => {
    expect((await publicSiteRoutes.request('/legal/cookies')).status).toBe(404);
    const long = await publicSiteRoutes.request(`/forms?search=${'x'.repeat(81)}`);
    expect(long.status).toBe(422);
    expect(await long.json()).toMatchObject({error: 'invalid_search', fields: {search: ['Use 80 characters or fewer']}});
    expect((await publicSiteRoutes.request('/forms?after=%3Cscript%3E')).status).toBe(422);
  });
});
