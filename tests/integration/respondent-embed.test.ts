import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {inRequestScope} from '../../src/platform/request-scope';
import {getDb} from '../../src/platform/db';
import {app} from '../../src/server/app';
import {renderToken} from '../../src/server/intelform/respondent/tokens';
import {configureEnv, DATABASE_URL, db, ORIGIN, renderTokenAt, resetDatabase} from './support/harness';

/**
 * A form embedded on ANOTHER website (public/embed.js: a cross-site iframe of /f/<slug>): the
 * browser keeps no cookie for this site there, so the respondent's writes carry NO cookie at all,
 * only the page's render token in `x-intelform-render`. Raw requests (no Browser harness: it
 * would fetch a CSRF cookie first). Runs only with TEST_DATABASE_URL.
 */
const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [
    {id: 'f_email', type: 'email', label: 'Email', required: true},
    {id: 'f_signa', type: 'signature', label: 'Sign here', required: false},
  ],
});

let seq = 0;
async function makeForm() {
  const slug = `embed-${++seq}`;
  const form = await db.form.create({
    data: {slug, title: `Embedded ${seq}`, status: 'live', draft: DEF as never, settings: defaultFormSettings() as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  const v = await db.formVersion.create({
    data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  await db.form.update({where: {id: form.id}, data: {publishedVersionId: v.id}, select: {id: true}});
  return {id: form.id, slug, versionId: v.id};
}

/** A POST from inside the iframe: same-origin fetch metadata (the frame is this site), no cookie. */
async function framePost(path: string, body: unknown, token: string | null) {
  const headers = new Headers({origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.90', 'content-type': 'application/json'});
  if (token) headers.set('x-intelform-render', token);
  const res = await inRequestScope(async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {}};
    const r = await app.request(`${ORIGIN}${path}`, {method: 'POST', headers, body: JSON.stringify(body)}, {}, ctx as never);
    while (pending.length) await pending.shift();
    await getDb()?.$disconnect();
    return r;
  });
  const text = await res.text();
  return {status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, unknown>, setCookie: res.headers.getSetCookie()};
}

describe.skipIf(!DATABASE_URL)('embedded form: respondent writes with no cookies (integration)', () => {
  const realFetch = globalThis.fetch;
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    // The platform's file API: a signature upload grant (nothing else is asked for here).
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/site/v1/files/uploads') && init?.method === 'POST') {
        const b = JSON.parse(String(init.body)) as {name: string; contentType: string; size: number; visibility: string};
        const file = {id: `file_${'d'.repeat(26)}`, ...b, status: 'pending', environment: 'staging', createdAt: new Date().toISOString(), completedAt: null};
        return new Response(JSON.stringify({data: {file, upload: {method: 'PUT', url: 'https://storage.example.test/x', headers: {}, expiresAt: '', direct: true}}}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        });
      }
      return realFetch(input, init);
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('a submit with no cookies at all is saved; a token for another form is refused', async () => {
    const form = await makeForm();
    const other = await makeForm();
    const token = await renderTokenAt(SECRET, form.id, '203.0.113.90');
    const body = {formVersionId: form.versionId, answers: {f_email: 'ada@example.com'}, renderToken: token, startedAt: Date.now() - 4000};

    const res = await framePost(`/site-api/public/forms/${form.slug}/responses`, body, token);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ok: true});
    expect(res.setCookie).toEqual([]);
    expect(await db.response.count({where: {formId: form.id}})).toBe(1);

    const otherToken = await renderToken(SECRET, other.id, Date.now() - 5000);
    const wrong = await framePost(`/site-api/public/forms/${form.slug}/responses`, {...body, renderToken: otherToken}, otherToken);
    expect(wrong.status).toBe(403);
    expect(wrong.json.error).toBe('page_invalid');
    const none = await framePost(`/site-api/public/forms/${form.slug}/responses`, body, null);
    expect(none.status).toBe(403);
    expect(await db.response.count({where: {formId: form.id}})).toBe(1);

    // The funnel beacon too.
    const view = await framePost(`/site-api/public/forms/${form.slug}/events`, {type: 'view', session: '6f1c1d2e-1111-4222-8333-444455556666'}, token);
    expect(view.status).toBe(204);
  });

  it('a signature upload with no cookies at all gets its grant; a token for another form is refused', async () => {
    const form = await makeForm();
    const other = await makeForm();
    const body = {formId: form.id, fieldId: 'f_signa', contentType: 'image/png', size: 1200};

    const res = await framePost('/site-api/uploads/signature', body, await renderToken(SECRET, form.id));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({fileId: `file_${'d'.repeat(26)}`, upload: {method: 'PUT'}});
    expect(typeof res.json.token).toBe('string');

    const wrong = await framePost('/site-api/uploads/signature', body, await renderToken(SECRET, other.id));
    expect(wrong.status).toBe(403);
    expect((await framePost('/site-api/uploads/signature', body, null)).status).toBe(403);
    // Both limits are one statement: one row per key.
    const keys = await db.$queryRaw<{key: string; count: number}[]>`SELECT key, count FROM intelform_rate_limits WHERE key LIKE 'upload:sig:%' ORDER BY key`;
    expect(keys).toHaveLength(2);
    expect(keys.every(k => k.count === 1)).toBe(true);
  });

  it('a password form unlocks from the frame: the render token comes with the locked form', async () => {
    const {hashPassword} = await import('../../src/platform/auth/password');
    const form = await makeForm();
    await db.form.update({where: {id: form.id}, data: {settings: {...defaultFormSettings(), passwordHash: await hashPassword('open sesame')} as never}, select: {id: true}});
    const locked = await app.request(`${ORIGIN}/site-api/public/forms/${form.slug}`, {headers: {'cf-connecting-ip': '203.0.113.90'}});
    const lockedJson = (await locked.json()) as {status: string; renderToken?: string};
    expect(lockedJson.status).toBe('locked');
    expect(lockedJson.renderToken).toMatch(/^\d+\./);
    const unlocked = await framePost(`/site-api/public/forms/${form.slug}/unlock`, {password: 'open sesame'}, lockedJson.renderToken!);
    expect(unlocked.status).toBe(200);
    expect((unlocked.json.form as {status: string}).status).toBe('live');
    expect((await framePost(`/site-api/public/forms/${form.slug}/unlock`, {password: 'open sesame'}, null)).status).toBe(403);
  });
});
