import {createHash} from 'node:crypto';

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  allowFraming,
  fontPreloads,
  loadFormPage,
  movedLocation,
  pageMeta,
  stateOf,
  statusOf,
  themeStyle,
  type FormPageState,
} from '../../src/pages/f/_lib/page';
import {Prisma} from '../../src/generated/prisma-node/client';
import type {PublicFormClosed, PublicFormLive} from '../../src/lib/intelform/api-public';
import {blankDefinition} from '../../src/lib/intelform/form/definition';
import {clearPublicFormCache} from '../../src/server/intelform/respondent/cache';
import {defaultFormSettings, publicSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme, type FormTheme} from '../../src/lib/intelform/form/theme-core';
import {normalizeFields, PublicApiError, readCookieValue} from '../../src/respondent/api';
import {filterOptions} from '../../src/respondent/Combobox';
import {embedOptions, embedQuery} from '../../src/respondent/embed';
import {submitFailure} from '../../src/respondent/submit-result';
import {cssValue, styleHash, themeCss} from '../../src/respondent/theme-css';

const FORM = '00000000-0000-4000-8000-00000000f001';
const VERSION = '00000000-0000-4000-8000-0000000000a1';
const SECRET = 'test-secret-test-secret-test-secret-0123';

const theme = (patch: Partial<FormTheme> = {}): FormTheme => ({...defaultTheme(), ...patch});
const settings = publicSettings(defaultFormSettings());

const live = (patch: Partial<PublicFormLive> = {}): PublicFormLive => ({
  id: FORM,
  slug: 'contact-us',
  title: 'Contact us',
  theme: theme(),
  settings,
  status: 'live',
  versionId: VERSION,
  version: 1,
  definition: blankDefinition(),
  renderToken: 'r',
  ...patch,
});

describe('embed options', () => {
  it('reads ?embed, transparent and hideTitle', () => {
    expect(embedOptions('')).toEqual({embed: null, transparent: false, hideTitle: false});
    expect(embedOptions('?embed=1')).toEqual({embed: 'inline', transparent: false, hideTitle: false});
    expect(embedOptions('?embed=popup&transparent=1&hideTitle=1')).toEqual({embed: 'popup', transparent: true, hideTitle: true});
    expect(embedOptions(new URLSearchParams('embed=yes&transparent=true')).transparent).toBe(false);
  });

  it('keeps only the embed options when redirecting an old slug', () => {
    expect(embedQuery(embedOptions('?embed=1&utm_source=x&transparent=1'))).toBe('?embed=1&transparent=1');
    expect(embedQuery(embedOptions('?utm=1'))).toBe('');
    expect(movedLocation('new slug', embedOptions('?embed=popup'))).toBe('/f/new%20slug/?embed=popup');
  });
});

describe('theme <style>', () => {
  it('writes every theme variable on the selector', () => {
    const css = themeCss(theme(), '.rf-page');
    expect(css.startsWith('.rf-page{')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    expect(css).toContain('--form-bg:#F5F2EA');
    expect(css).toContain('--form-font:"Figtree Variable", "Figtree"');
  });

  it('never lets a value close the <style> or the rule', () => {
    expect(cssValue('#fff')).toBe('#fff');
    expect(cssValue('url("https://x.test/a.png")')).toBe('url("https://x.test/a.png")');
    expect(cssValue('url("https://x.test/</style><script>")')).not.toContain('<');
    expect(cssValue('red;}body{display:none')).toBeNull();
    expect(cssValue('"a" } b')).toBeNull();
    expect(cssValue('a\nb')).toBeNull();
    const css = themeCss(theme({background: {type: 'image', imageUrl: 'https://x.test/</style>.png', overlay: 40}}));
    expect(css).not.toMatch(/<\/style/i);
  });

  it('hashes the exact text the way a CSP does', async () => {
    const css = themeCss(theme());
    const expected = `sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}`;
    expect(await styleHash(css)).toBe(expected);
    expect((await themeStyle(theme())).hash).toBe(expected);
  });

  it('preloads the theme fonts once each', () => {
    expect(fontPreloads(theme({font: 'Inter', questionFont: 'Inter'}))).toEqual(['/fonts/inter-latin-wght-normal.woff2']);
    expect(fontPreloads(theme({font: 'Inter', questionFont: 'Lora'}))).toHaveLength(2);
  });
});

describe('page state', () => {
  // The published form is cached by slug (respondent/cache.ts): every case starts from the database.
  beforeEach(() => clearPublicFormCache());
  /** A fake db: the exact-count read answers `responses.n`, the form read answers `rows`. */
  const responses = {n: 0};
  const dbOf = (rows: unknown[], _count = 1, fail = false) => {
    const calls: string[] = [];
    const db = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Nested fragments inlined, as Prisma sends them.
        const sql = Prisma.sql(strings, ...values).sql;
        calls.push(sql);
        if (fail) throw new Error('connection lost');
        if (sql.includes('intelform_rate_limits')) throw new Error('a page load writes no rate-limit row');
        if (sql.includes("AS password_hash") && !sql.includes('form_versions')) return [{responses: responses.n, password_hash: null}];
        return rows;
      },
      intelformSettings: {findUnique: async () => null},
    };
    return {db: db as never, calls};
  };
  const row = {
    id: FORM,
    slug: 'contact-us',
    title: 'Contact us',
    status: 'live',
    response_count: 0,
    settings: {},
    published_version_id: VERSION,
    version: 1,
    definition: blankDefinition(),
    theme: {},
    moved: false,
  };

  it('a malformed slug is a 404 without a query', async () => {
    const {db, calls} = dbOf([row]);
    const s = await loadFormPage({db, secret: SECRET, slug: '../etc', ip: null});
    expect(s).toEqual({kind: 'missing'});
    expect(calls).toHaveLength(0);
    expect(statusOf(s)).toBe(404);
  });

  it('no database or secret is a 503, never a 404', async () => {
    expect(await loadFormPage({db: null, secret: SECRET, slug: 'contact-us', ip: null})).toEqual({kind: 'unavailable'});
    expect(await loadFormPage({db: dbOf([row]).db, secret: null, slug: 'contact-us', ip: null})).toEqual({kind: 'unavailable'});
    const failing = await loadFormPage({db: dbOf([row], 1, true).db, secret: SECRET, slug: 'contact-us', ip: '203.0.113.5'});
    expect(failing).toEqual({kind: 'unavailable'});
    expect(statusOf(failing)).toBe(503);
  });

  it('a live form renders the island; once cached a view runs no statement at all, and none that writes', async () => {
    const {db, calls} = dbOf([row]);
    const s = await loadFormPage({db, secret: SECRET, slug: 'Contact-Us', ip: '203.0.113.5'});
    expect(s.kind).toBe('form');
    expect(s.kind === 'form' && s.payload.status).toBe('live');
    // A cache miss: the form read only.
    expect(calls).toHaveLength(1);
    expect(statusOf(s)).toBe(200);
    // Cached now: nothing reaches the database.
    calls.length = 0;
    expect((await loadFormPage({db, secret: SECRET, slug: 'contact-us', ip: '203.0.113.5'})).kind).toBe('form');
    expect(calls).toHaveLength(0);
  });

  it('a cached capped form: one read of its exact count (no write)', async () => {
    const capped = {...row, settings: {responseCap: 2}, response_count: 0};
    const {db, calls} = dbOf([capped]);
    expect((await loadFormPage({db, secret: SECRET, slug: 'contact-us', ip: null})).kind).toBe('form');
    calls.length = 0;
    responses.n = 2;
    const s = await loadFormPage({db, secret: SECRET, slug: 'contact-us', ip: null});
    responses.n = 0;
    expect(s.kind).toBe('closed');
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('intelform_rate_limits');
    expect(calls[0]).toContain('form_counts');
  });

  it('old slugs move, drafts and unknown slugs are missing', async () => {
    const moved = await loadFormPage({db: dbOf([{...row, slug: 'new-slug', moved: true}]).db, secret: SECRET, slug: 'old', ip: null});
    expect(moved).toEqual({kind: 'moved', slug: 'new-slug'});
    expect(statusOf(moved)).toBe(301);
    expect(await loadFormPage({db: dbOf([{...row, status: 'draft'}]).db, secret: SECRET, slug: 'contact-us', ip: null})).toEqual({kind: 'missing'});
    expect(await loadFormPage({db: dbOf([]).db, secret: SECRET, slug: 'contact-us', ip: null})).toEqual({kind: 'missing'});
  });

  it('a closed form is drawn by the server', async () => {
    const s = await loadFormPage({db: dbOf([{...row, status: 'closed'}]).db, secret: SECRET, slug: 'contact-us', ip: null});
    expect(s.kind).toBe('closed');
    const meta = pageMeta(s, embedOptions(''));
    expect(meta.message?.title).toBeTruthy();
    expect(meta.noindex).toBe(true);
  });

  it('stateOf maps every payload', () => {
    expect(stateOf(null)).toEqual({kind: 'missing'});
    expect(stateOf({status: 'moved', redirectTo: 'x'})).toEqual({kind: 'moved', slug: 'x'});
    const closed: PublicFormClosed = {id: FORM, slug: 's', title: 't', theme: theme(), settings, status: 'closed', message: 'Gone'};
    expect(stateOf(closed).kind).toBe('closed');
    expect(stateOf(live()).kind).toBe('form');
  });
});

describe('page meta', () => {
  const indexable = {...settings, noindex: false, seoTitle: 'Talk to us', seoDescription: 'Say hello', ogImage: 'https://x.test/og.png'};

  it('uses the SEO settings and indexes only a live page form that allows it', () => {
    const state: FormPageState = {kind: 'form', payload: live({settings: indexable})};
    const m = pageMeta(state, embedOptions(''));
    expect(m).toMatchObject({title: 'Talk to us', description: 'Say hello', ogImage: 'https://x.test/og.png', noindex: false, message: null});
    expect(pageMeta(state, embedOptions('?embed=1')).noindex).toBe(true);
    expect(pageMeta({kind: 'form', payload: live()}, embedOptions('')).noindex).toBe(true);
    expect(pageMeta({kind: 'form', payload: live({settings: {...indexable, seoTitle: ''}})}, embedOptions('')).title).toBe('Contact us');
  });

  it('missing, limited and unavailable pages say so in words, on the default theme', () => {
    for (const kind of ['missing', 'unavailable'] as const) {
      const m = pageMeta({kind}, embedOptions(''));
      expect(m.noindex).toBe(true);
      expect(m.message?.title).toBeTruthy();
      expect(m.message?.body).toBeTruthy();
    }
    expect(pageMeta({kind: 'limited', retryAfter: 5}, embedOptions('')).message?.title).toBe('Too many requests');
  });
});

describe('CSP additions', () => {
  const csp = () => ({insertDirective: vi.fn(), insertScriptResource: vi.fn(), insertStyleHash: vi.fn()});

  it('lets any site frame the form', () => {
    const c = csp();
    allowFraming(c);
    expect(c.insertDirective).toHaveBeenCalledWith('frame-ancestors *');
    allowFraming(undefined);
  });

  it('lets only the listed sites frame a form that names them (header and CSP alike)', () => {
    const c = csp();
    const headers = new Headers();
    allowFraming(c, headers, ['https://shop.example.com', 'https://blog.example.org:8443']);
    expect(c.insertDirective).toHaveBeenCalledWith("frame-ancestors 'self' https://shop.example.com https://blog.example.org:8443");
    expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self' https://shop.example.com https://blog.example.org:8443");
    // Anything that isn't a plain origin never reaches the header.
    const h2 = new Headers();
    allowFraming(undefined, h2, ["https://ok.example.com; script-src 'unsafe-inline'", 'javascript:alert(1)']);
    expect(h2.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
  });
});

describe('respondent client helpers', () => {
  it('normalizes error bodies', () => {
    const e = new PublicApiError(422, {error: 'validation_failed', message: 'Check', fields: {a: 'one', b: ['two'], c: undefined}});
    expect(e.code).toBe('validation_failed');
    expect(e.fields).toEqual({a: ['one'], b: ['two']});
    expect(new PublicApiError(0, null).code).toBe('offline');
    expect(normalizeFields(null)).toEqual({});
  });

  it('reads one cookie', () => {
    expect(readCookieValue('a=1; if_r_x=tok; b=2', 'if_r_x')).toBe('tok');
    expect(readCookieValue('a=1', 'if_r_x')).toBeNull();
    expect(readCookieValue('if_r_x=', 'if_r_x')).toBeNull();
  });

  it('maps submit failures', () => {
    const on = {onClosed: vi.fn(), onLocked: vi.fn(), reload: vi.fn()};
    expect(submitFailure(new Error('x'), on)).toMatchObject({ok: false, errors: {}});
    expect(submitFailure(new PublicApiError(422, {error: 'validation_failed', message: 'm', fields: {f1: ['Required']}}), on)).toEqual({
      ok: false,
      errors: {f1: 'Required'},
    });
    submitFailure(new PublicApiError(403, {error: 'form_closed', message: 'Closed now'}), on);
    expect(on.onClosed).toHaveBeenCalledWith('Closed now');
    submitFailure(new PublicApiError(401, {error: 'locked', message: 'Locked'}), on);
    expect(on.onLocked).toHaveBeenCalled();
    const outdated = submitFailure(new PublicApiError(409, {error: 'version_unknown', message: 'x'}), on);
    expect(outdated.ok === false && outdated.action?.label).toBe('Reload');
    if (!outdated.ok) outdated.action?.run();
    expect(on.reload).toHaveBeenCalled();
    expect(submitFailure(new PublicApiError(429, {error: 'rate_limited', message: 'Slow down'}), on)).toMatchObject({message: 'Slow down'});
  });

  it('filters combobox options: starts-with first, then contains', () => {
    const opts = [
      {value: 'a', label: 'Bangladesh'},
      {value: 'b', label: 'Bahamas'},
      {value: 'c', label: 'Albania'},
    ];
    expect(filterOptions(opts, 'ba').map(o => o.value)).toEqual(['a', 'b', 'c']);
    expect(filterOptions(opts, 'al').map(o => o.value)).toEqual(['c']);
    expect(filterOptions(opts, 'an').map(o => o.value)).toEqual(['a', 'c']);
    expect(filterOptions(opts, ' ')).toHaveLength(3);
  });
});
