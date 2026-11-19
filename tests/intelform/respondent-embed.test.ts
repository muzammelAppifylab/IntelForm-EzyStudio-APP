import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../integration/support/cloudflare-workers';
import {setCacheModeForTests} from '../../src/platform/cache';
import {RENDER_HEADER as CLIENT_RENDER_HEADER} from '../../src/respondent/api';
import {renderToken} from '../../src/server/intelform/respondent/tokens';
import {RENDER_HEADER} from '../../src/server/routes/public-forms';

/**
 * Embedded forms (a cross-site iframe of /f/<slug>) have no CSRF cookie, so the respondent's
 * writes are mounted BEFORE `csrf` and gated by the page's render token instead
 * (src/server/app.ts, src/server/routes/public-forms.ts). No database: getDb() is a stub whose
 * queries are recorded, so these tests show what runs before anything touches it.
 */
const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const FORM = '00000000-0000-4000-8000-00000000e001';
const OTHER = '00000000-0000-4000-8000-00000000e002';
const ORIGIN = 'https://site.example.test';

const queries: string[] = [];
const fakeDb = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray | {strings?: string[]}) => {
    const text = Array.isArray(strings) ? strings.join('?') : String((strings as {strings?: string[]}).strings ?? '');
    queries.push(text);
    // The slug → id lookup of the render-token gate.
    if (/SELECT id::text AS id FROM forms WHERE slug/.test(text)) return [{id: FORM}];
    throw new Error('stop: the request reached the database past the gate');
  }),
};
vi.mock('../../src/platform/db', () => ({getDb: () => fakeDb}));

const {app} = await import('../../src/server/app');

/** A browser inside a third-party iframe: same-origin fetch metadata, but NO cookies at all. */
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

describe('respondent writes without a CSRF cookie (embedded forms)', () => {
  beforeAll(() => setCacheModeForTests('memory'));
  afterAll(() => setCacheModeForTests(null));
  beforeEach(() => {
    env.JWT_SECRET = SECRET;
    env.DATABASE_URL = 'postgresql://stub/stub';
    queries.length = 0;
  });
  afterEach(() => {
    delete env.JWT_SECRET;
    delete env.DATABASE_URL;
  });

  it('client and server agree on the header name', () => {
    expect(CLIENT_RENDER_HEADER).toBe(RENDER_HEADER);
  });

  it('a submit with a valid render-token header passes csrf and reaches validation', async () => {
    const token = await renderToken(SECRET, FORM);
    const res = await post('/site-api/public/forms/embedded-a/responses', {not: 'a submit'}, {[RENDER_HEADER]: token});
    expect(res.status).not.toBe(403);
    const body = (await res.json()) as {error?: string};
    expect(body.error).not.toBe('csrf_failed');
    // The submit's own body validation answered: only the gate's slug lookup touched the database.
    expect([400, 422]).toContain(res.status);
    expect(queries).toHaveLength(1);
  });

  it('refuses a write with no header, a forged one or one for another form, before any form work', async () => {
    const noHeader = await post('/site-api/public/forms/embedded-b/responses', {});
    expect(noHeader.status).toBe(403);
    expect(await noHeader.json()).toMatchObject({error: 'page_invalid'});
    // No lookup for a missing or malformed header.
    expect(queries).toHaveLength(0);

    const forged = await post('/site-api/public/forms/embedded-b/events', {type: 'view', session: 'x'}, {[RENDER_HEADER]: `${Date.now()}.${'A'.repeat(32)}`});
    expect(forged.status).toBe(403);

    const otherForm = await post('/site-api/public/forms/embedded-b/unlock', {password: 'x'}, {[RENDER_HEADER]: await renderToken(SECRET, OTHER)});
    expect(otherForm.status).toBe(403);
    expect(await otherForm.json()).toMatchObject({error: 'page_invalid'});
  });

  it('signature upload: the header must be for the form in the body; checked before any query', async () => {
    const body = {formId: FORM, fieldId: 'sig', contentType: 'image/png', size: 100};
    const none = await post('/site-api/uploads/signature', body);
    expect(none.status).toBe(403);
    const other = await post('/site-api/uploads/signature', body, {[RENDER_HEADER]: await renderToken(SECRET, OTHER)});
    expect(other.status).toBe(403);
    expect(queries).toHaveLength(0);
    // With the right token it goes on to its rate limits (the stub database stops it there).
    const ok = await post('/site-api/uploads/signature', body, {[RENDER_HEADER]: await renderToken(SECRET, FORM)});
    expect(ok.status).toBe(500);
    expect(queries.some(q => q.includes('intelform_rate_limits'))).toBe(true);
  });

  it('another site still cannot post (sameOrigin runs first)', async () => {
    const res = await app.request(`${ORIGIN}/site-api/public/forms/embedded-c/responses`, {
      method: 'POST',
      headers: {origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json', [RENDER_HEADER]: await renderToken(SECRET, FORM)},
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({error: 'cross_site'});
  });

  it('signed-in routes still need the CSRF token: an editor upload and a form create', async () => {
    const token = await renderToken(SECRET, FORM);
    for (const path of ['/site-api/uploads', '/site-api/uploads/file_x/complete', '/site-api/forms', '/site-api/uploads/signatures']) {
      const res = await post(path, {name: 'a.png', contentType: 'image/png', size: 10, purpose: 'image'}, {[RENDER_HEADER]: token});
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toMatchObject({error: 'csrf_failed'});
    }
    // An unknown path under the public prefix falls through to csrf as well.
    const stray = await post('/site-api/public/forms/x/other', {}, {[RENDER_HEADER]: token});
    expect(stray.status).toBe(403);
    expect(await stray.json()).toMatchObject({error: 'csrf_failed'});
  });
});
