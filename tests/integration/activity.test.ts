import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, ownerAccountId, ownerSignedIn, resetDatabase, signedIn, userId} from './support/harness';

/**
 * /site-api/activity against a real Postgres: who may read it, what the app logs, and the filters.
 * Runs only with TEST_DATABASE_URL (a throwaway database: resetDatabase truncates it).
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!DATABASE_URL)('activity log (integration, real Postgres)', () => {
  let owner: Browser;
  let editor: Browser;
  let ids: {owner: number; editor: number};

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await ownerSignedIn(app, undefined, '203.0.113.1');
    editor = await signedIn(app, 'editor@example.test', undefined, '203.0.113.2');
    ids = {owner: await ownerAccountId(), editor: await userId('editor@example.test')};
    expect((await owner.request('PUT', `/site-api/admin/users/${ids.editor}/roles`, {roles: ['member', 'editor']})).status).toBe(200);
  });

  const events = async (query = '', as: Browser = owner) => {
    const res = await as.get(`/site-api/activity${query}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.events as Json[];
  };

  it('is for people who may read the log, and never shows an email address', async () => {
    expect((await new Browser(app).get('/site-api/activity')).status).toBe(401);
    expect((await editor.get('/site-api/activity')).status).toBe(403);
    expect((await editor.get('/site-api/activity/people')).status).toBe(403);
    const body = JSON.stringify(await (await owner.get('/site-api/activity')).json);
    expect(body).not.toContain('@example.test');
    expect(body).not.toContain('ipHash');
  });

  it('logs what people do to forms, by name, and keeps a deleted form’s title', async () => {
    const created = await editor.post('/site-api/forms', {title: 'Customer survey'});
    expect(created.status).toBe(201);
    const formId = created.json.id as string;
    const oneQuestion = {layout: 'all_at_once', fields: [{id: 'f_q0000001', type: 'short_text', label: 'Q', required: false, props: {}}]};
    expect((await editor.request('PATCH', `/site-api/forms/${formId}`, {draft: oneQuestion})).status).toBe(200);
    expect((await editor.post(`/site-api/forms/${formId}/publish`)).status).toBe(200);

    // While the form exists, the log names it by its current title.
    const live = await events('?category=forms');
    expect(live[0]).toMatchObject({action: 'form_published', targetName: 'Customer survey', meta: {version: 1}});

    expect((await editor.post(`/site-api/forms/${formId}/close`, {})).status).toBe(200);
    expect((await owner.request('DELETE', `/site-api/forms/${formId}`, {confirmTitle: 'Customer survey'})).status).toBe(204);

    const forms = await events('?category=forms');
    expect(forms.map(e => e.action)).toEqual(['form_deleted', 'form_closed', 'form_published', 'form_created']);
    expect(forms.every(e => e.category === 'forms')).toBe(true);
    expect(forms[3]).toMatchObject({actor: {id: ids.editor}, target: `form:${formId}`, meta: {title: 'Customer survey'}});
    expect(forms[0]).toMatchObject({actor: {id: ids.owner}, meta: {title: 'Customer survey'}, targetName: null});
  });

  it('filters by person (what they did and what was done to them) and by date', async () => {
    expect((await editor.post('/site-api/forms', {title: 'Mine'})).status).toBe(201);

    const editorOnly = await events(`?person=${ids.editor}`);
    expect(editorOnly.length).toBeGreaterThan(0);
    for (const e of editorOnly) {
      expect(e.actor?.id === ids.editor || e.target === `user:${ids.editor}`, JSON.stringify(e)).toBe(true);
    }
    // The owner changed the editor's roles: it shows under the editor too.
    expect(editorOnly.some(e => e.action === 'user_roles_changed')).toBe(true);

    const people = (await owner.get('/site-api/activity/people')).json.people as Json[];
    expect(people.map(p => p.id)).toEqual(expect.arrayContaining([ids.editor, ids.owner]));

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await events(`?from=${encodeURIComponent(future)}`)).toEqual([]);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await events(`?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`)).length).toBeGreaterThan(0);
  });

  it('pages newest first without gaps or repeats', async () => {
    for (let i = 0; i < 35; i++) {
      await db.auditEvent.create({data: {actorUserId: ids.editor, action: 'form_closed', targetType: 'form', targetId: 'x'}, select: {id: true}});
    }
    const first = await owner.get('/site-api/activity?category=forms');
    const page1 = first.json.events as Json[];
    expect(page1).toHaveLength(25);
    const second = await owner.get(`/site-api/activity?category=forms&before=${first.json.nextBefore}`);
    const page2 = second.json.events as Json[];
    expect(page2).toHaveLength(10);
    expect(second.json.nextBefore).toBeNull();
    const all = [...page1, ...page2].map(e => BigInt(e.id));
    expect(new Set(all).size).toBe(35);
    expect([...all].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))).toEqual(all);

    // Rows per page: 25, 50 or 100, nothing else.
    const big = await owner.get('/site-api/activity?category=forms&limit=50');
    expect(big.json.events).toHaveLength(35);
    expect(big.json.nextBefore).toBeNull();
    expect((await owner.get('/site-api/activity?limit=30')).status).toBe(422);
    expect((await owner.get('/site-api/activity?limit=100000')).status).toBe(422);
  });

  it('refuses bad filters with field errors', async () => {
    const res = await owner.get('/site-api/activity?category=nope&person=abc&from=yesterday');
    expect(res.status).toBe(422);
    expect(Object.keys(res.json.fields as Json).sort()).toEqual(['category', 'from', 'person']);
    const backwards = await owner.get(
      `/site-api/activity?from=${encodeURIComponent('2026-11-18T00:00:00.000Z')}&to=${encodeURIComponent('2026-11-01T00:00:00.000Z')}`
    );
    expect(backwards.status).toBe(422);
  });
});
