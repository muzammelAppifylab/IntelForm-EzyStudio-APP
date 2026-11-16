import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, ownerSignedIn, resetDatabase, signedIn, userId} from './support/harness';

/**
 * /site-api/forms against a real Postgres (IntelForm's server/routes/forms.test.ts, ported).
 * Runs only with TEST_DATABASE_URL (a throwaway database: resetDatabase truncates it).
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const field = (id: string, type: string, label: string, extra: Json = {}) => ({id, type, label, required: false, props: {}, ...extra});
const oneQuestion = {layout: 'all_at_once', fields: [field('f_q0000001', 'short_text', 'Q')]};

describe.skipIf(!DATABASE_URL)('forms API (integration, real Postgres)', () => {
  let owner: Browser;
  let editor: Browser;
  let viewer: Browser;
  let ids: {editor: number; viewer: number};

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await ownerSignedIn(app, undefined, '203.0.113.1');
    editor = await signedIn(app, 'editor@example.test', undefined, '203.0.113.2');
    viewer = await signedIn(app, 'viewer@example.test', undefined, '203.0.113.3');
    ids = {editor: await userId('editor@example.test'), viewer: await userId('viewer@example.test')};
    for (const [id, role] of [
      [ids.editor, 'editor'],
      [ids.viewer, 'viewer'],
    ] as const) {
      const res = await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', role]});
      expect(res.status).toBe(200);
    }
  });

  const newForm = async (as: Browser = owner, body: Json = {}) => {
    const res = await as.post('/site-api/forms', body);
    expect(res.status).toBe(201);
    return res.json as {id: string; slug: string; title: string};
  };

  /** A response the way the submit route writes one, counter included. */
  const addResponse = async (formId: string) => {
    const form = await db.form.findUniqueOrThrow({where: {id: formId}, select: {publishedVersionId: true}});
    await db.response.create({data: {formId, formVersionId: form.publishedVersionId!, answers: {}}, select: {id: true}});
    await db.form.update({where: {id: formId}, data: {responseCount: {increment: 1}, lastResponseAt: new Date()}, select: {id: true}});
  };

  it('needs a session, lets a viewer read but never write, and hides webhook secrets from readers', async () => {
    expect((await new Browser(app).get('/site-api/forms')).status).toBe(401);
    const form = await newForm();
    expect((await viewer.get('/site-api/forms')).status).toBe(200);
    expect((await viewer.get(`/site-api/forms/${form.id}`)).status).toBe(200);
    const writes: [string, string, unknown?][] = [
      ['POST', '/site-api/forms', {}],
      ['PATCH', `/site-api/forms/${form.id}`, {title: 'Nope'}],
      ['POST', `/site-api/forms/${form.id}/publish`],
      ['POST', `/site-api/forms/${form.id}/close`],
      ['POST', `/site-api/forms/${form.id}/reopen`],
      ['POST', `/site-api/forms/${form.id}/duplicate`],
      ['POST', `/site-api/forms/${form.id}/save-as-template`, {}],
      ['DELETE', `/site-api/forms/${form.id}`, {confirmTitle: form.title}],
    ];
    for (const [method, path, body] of writes) {
      expect((await viewer.request(method, path, body ?? {})).status, `${method} ${path}`).toBe(403);
    }

    const url = 'https://hooks.example.com/services/T000/B000/s3cr3tpath';
    const webhook = {url, enabled: true, headers: [{key: 'Authorization', value: 'Bearer tok_live_123'}]};
    const saved = await owner.request('PATCH', `/site-api/forms/${form.id}`, {settings: {webhook}});
    expect(saved.status).toBe(200);
    const seen = await viewer.get(`/site-api/forms/${form.id}`);
    expect((seen.json.settings as Json).webhook).toEqual({enabled: true, url: null, headers: [{key: 'Authorization', value: ''}]});
    expect(JSON.stringify(seen.json)).not.toContain('s3cr3tpath');
    expect(((await editor.get(`/site-api/forms/${form.id}`)).json.settings as Json).webhook).toMatchObject(webhook);
  });

  it('creates blank forms and forms from a built-in template with fresh ids', async () => {
    const blank = await newForm();
    expect(blank).toMatchObject({title: 'Untitled form'});
    expect(blank.slug).toMatch(/^[a-z0-9]{8}$/);
    const detail = (await owner.get(`/site-api/forms/${blank.id}`)).json;
    expect(detail).toMatchObject({status: 'draft', revision: 0, publishedVersion: null, counts: {fields: 0, logicRules: 0, responses: 0}});

    const lead = await newForm(editor, {templateSlug: 'builtin-lead-capture'});
    expect(lead.title).toBe('Lead capture');
    const body = (await owner.get(`/site-api/forms/${lead.id}`)).json as Json;
    expect(body.draft.fields.map((f: Json) => f.id)).not.toContain('f_lcemail');
    expect(body.draft.fields.map((f: Json) => f.id)).toContain(body.settings.onePerEmailFieldId);
    expect((await owner.post('/site-api/forms', {templateSlug: 'no-such-template'})).status).toBe(404);
  });

  it('autosaves with last-save-wins, slug history, password hashing and publish', async () => {
    const a = await newForm();
    const b = await newForm();
    const first = await owner.request('PATCH', `/site-api/forms/${a.id}`, {title: 'Mine', slug: 'spring-survey'}, {'if-match': '"0"'});
    expect(first.json).toMatchObject({revision: 1, overwrote: false, slug: 'spring-survey'});
    const stale = await editor.request('PATCH', `/site-api/forms/${a.id}`, {title: 'Theirs'}, {'if-match': '"0"'});
    expect(stale.json).toMatchObject({revision: 2, overwrote: true});
    expect((await owner.request('PATCH', `/site-api/forms/${b.id}`, {slug: 'spring-survey'})).status).toBe(422);
    expect((await owner.request('PATCH', `/site-api/forms/${b.id}`, {slug: a.slug})).status).toBe(422);

    const pw = await owner.request('PATCH', `/site-api/forms/${a.id}`, {settings: {password: 'open sesame'}});
    expect((pw.json.settings as Json).hasPassword).toBe(true);
    expect(JSON.stringify(pw.json)).not.toContain('open sesame');

    expect((await owner.post(`/site-api/forms/${a.id}/publish`)).status).toBe(422);
    await owner.request('PATCH', `/site-api/forms/${a.id}`, {draft: oneQuestion});
    expect((await owner.post(`/site-api/forms/${a.id}/publish`)).json).toMatchObject({version: 1, status: 'live'});
    expect((await editor.post(`/site-api/forms/${a.id}/close`)).json).toMatchObject({status: 'closed'});
    expect((await editor.post(`/site-api/forms/${a.id}/reopen`)).json).toMatchObject({status: 'live'});
  });

  it('blocks publish on logic issues', async () => {
    const form = await newForm();
    const draft = {
      layout: 'all_at_once',
      fields: [
        field('f_first001', 'short_text', 'First', {logic: {action: 'show', match: 'all', conditions: [{field: 'f_later001', op: 'is_not_empty'}]}}),
        field('f_later001', 'short_text', 'Later'),
      ],
    };
    expect((await owner.request('PATCH', `/site-api/forms/${form.id}`, {draft})).status).toBe(200);
    const res = await owner.post(`/site-api/forms/${form.id}/publish`);
    expect(res.status).toBe(422);
    expect(res.json.error).toBe('logic_issues');
    expect((res.json.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it('duplicates without responses or the webhook secret, saves as template, deletes with the typed title', async () => {
    const form = await newForm(owner, {title: 'Feedback'});
    await owner.request('PATCH', `/site-api/forms/${form.id}`, {draft: oneQuestion, settings: {closedMessage: 'Done'}});
    await owner.post(`/site-api/forms/${form.id}/publish`);
    await addResponse(form.id);
    await db.form.update({where: {id: form.id}, data: {webhookSecret: 'v1.secret'}, select: {id: true}});

    const copy = await editor.post(`/site-api/forms/${form.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json.title).toBe('Copy of Feedback');
    const copied = await db.form.findUniqueOrThrow({where: {id: copy.json.id as string}, select: {webhookSecret: true, responseCount: true}});
    expect(copied).toEqual({webhookSecret: null, responseCount: 0});

    const tpl = await editor.post(`/site-api/forms/${form.id}/save-as-template`, {});
    expect(tpl.status).toBe(201);
    expect(tpl.json).toMatchObject({name: 'Feedback', isBuiltin: false, category: 'Saved'});

    expect((await owner.request('DELETE', `/site-api/forms/${form.id}`, {confirmTitle: 'feedback'})).status).toBe(422);
    expect((await viewer.request('DELETE', `/site-api/forms/${form.id}`, {confirmTitle: 'Feedback'})).status).toBe(403);
    expect((await editor.request('DELETE', `/site-api/forms/${form.id}`, {confirmTitle: 'Feedback'})).status).toBe(204);
    expect(await db.response.count({where: {formId: form.id}})).toBe(0);
  });

  it('lists with search, keyset pages and the weekly strip; remembers grid or list', async () => {
    const zeta = await newForm(owner, {title: 'Zeta poll'});
    await newForm(owner, {title: 'Alpha 100% survey'});
    await owner.request('PATCH', `/site-api/forms/${zeta.id}`, {draft: oneQuestion});
    await owner.post(`/site-api/forms/${zeta.id}/publish`);
    await addResponse(zeta.id);
    await db.$executeRaw`INSERT INTO form_event_counts (form_id, bucket, views, starts) VALUES (${zeta.id}::uuid, now() - interval '90 days', 0, 3), (${zeta.id}::uuid, now(), 0, 1)`;

    const search = (await viewer.get('/site-api/forms?q=zeta')).json as Json;
    expect(search.forms[0]).toMatchObject({title: 'Zeta poll', responseCount: 1, completionRate: 0.25, newThisWeek: 1});
    expect(((await owner.get('/site-api/forms?q=100%25')).json.forms as Json[]).map(f => f.title)).toEqual(['Alpha 100% survey']);

    await db.$executeRaw`
      INSERT INTO forms (slug, title, draft, updated_at) SELECT 'paged-' || n, 'Paged ' || n, '{}'::jsonb, '2026-01-01T00:00:00Z' FROM generate_series(1, 30) n`;
    const p1 = (await viewer.get('/site-api/forms?q=Paged')).json as Json;
    const p2 = (await viewer.get(`/site-api/forms?q=Paged&cursor=${p1.nextCursor}`)).json as Json;
    expect(p1).toMatchObject({matched: 30, page: 1, pageSize: 24});
    expect(p2).toMatchObject({page: 2, nextCursor: null});
    expect(new Set([...p1.forms, ...p2.forms].map((f: Json) => f.id)).size).toBe(30);

    const strip = (await owner.get('/site-api/forms/strip')).json as Json;
    expect(strip.days).toHaveLength(7);
    expect(strip.mostActive.find((f: Json) => f.id === zeta.id)).toMatchObject({completionRate: 0.25});

    expect((await viewer.get('/site-api/forms/prefs/view')).json.view).toBe('grid');
    expect((await viewer.request('PATCH', '/site-api/forms/prefs/view', {view: 'list'})).status).toBe(200);
    expect((await viewer.get('/site-api/forms/prefs/view')).json.view).toBe('list');
    expect((await owner.get('/site-api/forms/prefs/view')).json.view).toBe('grid');
  });
});
