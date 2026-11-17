import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {insertDelivery, runDelivery} from '../../src/server/intelform/builder/webhook-delivery';
import {renderToken} from '../../src/server/intelform/respondent/tokens';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * The builder API (src/server/routes/builder.ts and intelform/builder/form-routes.ts) through
 * the real Site API: who may and may not, autosave with revisions, slugs, publish, presence and
 * the webhook tools. The draft routes are tested at /site-api/builder/forms (always mounted);
 * /site-api/forms/:id answers the same once app.ts mounts formDraftRoutes there.
 */
describe.skipIf(!DATABASE_URL)('builder API (integration, real Postgres)', () => {
  let editor: Browser;
  let other: Browser;
  let viewer: Browser;
  let nobody: Browser;
  let formId: string;

  async function setRoles(email: string, ...slugs: string[]) {
    const id = await userId(email);
    const roles = await db.role.findMany({where: {slug: {in: slugs}}, select: {id: true}});
    await db.userRole.deleteMany({where: {userId: id}});
    await db.userRole.createMany({data: roles.map(role => ({userId: id, roleId: role.id}))});
  }

  const path = (rest = '') => `/site-api/builder/forms/${formId}${rest}`;
  const patch = (b: Browser, body: unknown, revision?: number) =>
    b.request('PATCH', path(), body, revision === undefined ? {} : {'if-match': `"${revision}"`});

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    editor = await signedIn(app, 'editor@example.test', undefined, '203.0.113.21');
    other = await signedIn(app, 'other@example.test', undefined, '203.0.113.22');
    viewer = await signedIn(app, 'viewer@example.test', undefined, '203.0.113.23');
    nobody = await signedIn(app, 'member@example.test', undefined, '203.0.113.24');
    await setRoles('editor@example.test', 'member', 'editor');
    await setRoles('other@example.test', 'member', 'editor');
    await setRoles('viewer@example.test', 'member', 'viewer');
    await setRoles('member@example.test', 'member');
    const form = await db.form.create({
      data: {slug: 'first-form', title: 'First', draft: {layout: 'all_at_once', fields: []}},
      select: {id: true},
    });
    formId = form.id;
  });

  it('needs a session and the right permission', async () => {
    expect((await new Browser(app).request('PATCH', path(), {title: 'x'})).status).toBe(401);
    expect((await patch(nobody, {title: 'x'})).status).toBe(403);
    expect((await patch(viewer, {title: 'x'})).status).toBe(403);
    expect((await viewer.post(path('/publish'))).status).toBe(403);
    expect((await viewer.get(path('/webhook'))).status).toBe(403);
    expect((await viewer.get(path('/versions'))).status).toBe(200);
    expect((await nobody.post(path('/presence'), {tabId: 'tab-12345678'})).status).toBe(403);
    expect((await viewer.post(path('/presence'), {tabId: 'tab-12345678'})).status).toBe(200);
    expect((await editor.request('PATCH', '/site-api/builder/forms/not-a-uuid', {title: 'x'})).status).toBe(404);
  });

  it('autosaves: last save wins and reports whose save it replaced', async () => {
    const first = await patch(editor, {title: 'Mine'}, 0);
    expect(first.json).toMatchObject({revision: 1, overwrote: false, overwrittenBy: null});
    const stale = await patch(other, {title: 'Theirs'}, 0);
    expect(stale.status).toBe(200);
    expect(stale.json).toMatchObject({revision: 2, overwrote: true, overwrittenBy: {id: await userId('editor@example.test')}});
    const bad = await patch(editor, {draft: {layout: 'sideways', fields: []}});
    expect(bad.status).toBe(422);
    expect((await patch(editor, {settings: {passwordHash: 'x'}})).status).toBe(422);
  });

  it('keeps old slugs as redirects and refuses taken ones', async () => {
    const b = await db.form.create({data: {slug: 'second-form', title: 'B', draft: {}}, select: {id: true}});
    expect((await patch(editor, {slug: 'spring-survey'})).json.slug).toBe('spring-survey');
    const taken = await editor.request('PATCH', `/site-api/builder/forms/${b.id}`, {slug: 'first-form'});
    expect(taken.status).toBe(422);
    expect((taken.json.fields as Record<string, unknown>).slug).toBeDefined();
    expect((await patch(editor, {slug: 'first-form'})).status).toBe(200);
  });

  it('publishes versions, idempotently', async () => {
    expect((await editor.post(path('/publish'))).json.error).toBe('empty_form');
    await patch(editor, {draft: {layout: 'all_at_once', fields: [{id: 'f_name0001', type: 'short_text', label: 'Name', props: {}}]}});
    const key = {'idempotency-key': `publish-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`};
    const first = await editor.request('POST', path('/publish'), {}, key);
    expect(first.json).toMatchObject({version: 1, status: 'live'});
    const repeat = await editor.request('POST', path('/publish'), {}, key);
    expect(repeat.json).toMatchObject({version: 1});
    expect(await db.formVersion.count({where: {formId}})).toBe(1);
    const versions = await viewer.get(path('/versions'));
    expect((versions.json.versions as {version: number; live: boolean}[])[0]).toMatchObject({version: 1, live: true});
    expect((await viewer.get(path('/versions/1'))).status).toBe(200);
    expect((await viewer.get(path('/versions/9'))).status).toBe(404);
  });

  it('concurrent publishes of one change write one version, and mid-form respondents still submit (F-008)', async () => {
    const field = (label: string) => ({layout: 'all_at_once', fields: [{id: 'f_name0001', type: 'short_text', label, props: {}}]});
    await patch(editor, {draft: field('Name')});
    const v1 = await editor.post(path('/publish'));
    expect(v1.json).toMatchObject({version: 1, status: 'live'});
    const v1Id = (await db.formVersion.findFirstOrThrow({where: {formId, version: 1}, select: {id: true}})).id;
    // A respondent opens version 1 now and submits after the owner republished.
    const token = await renderToken('integration-test-secret-0123456789-abcdefghijklmnop', formId, Date.now() - 5000);

    expect((await patch(editor, {draft: field('Your name')})).json.hasUnpublished).toBe(true);
    // Two teammates, two tabs, retries: ten publishes of the same change at once, without keys.
    const replies = await Promise.all(Array.from({length: 10}, (_, i) => (i % 2 ? other : editor).post(path('/publish'))));
    expect(replies.map(r => r.status)).toEqual(Array(10).fill(200));
    expect(replies.map(r => r.json.version)).toEqual(Array(10).fill(2));
    expect(await db.formVersion.count({where: {formId}})).toBe(2);

    const submit = await new Browser(app).post('/site-api/public/forms/first-form/responses', {
      formVersionId: v1Id,
      answers: {f_name0001: 'Ada'},
      renderToken: token,
      startedAt: Date.now() - 4000,
    });
    expect(submit.status).toBe(200);
  });

  it('presence: editors are seen, viewers are not', async () => {
    await editor.post(path('/presence'), {tabId: 'tab-editor01'});
    const seen = await viewer.post(path('/presence'), {tabId: 'tab-viewer01'});
    expect((seen.json.others as {name: string}[]).map(o => o.name)).toEqual(['editor']);
    const seenByEditor = await editor.post(path('/presence'), {tabId: 'tab-editor01'});
    expect(seenByEditor.json.others).toEqual([]);
    expect((await editor.delete(path('/presence/tab-editor01'))).status).toBe(204);
    expect((await viewer.post(path('/presence'), {tabId: 'tab-viewer01'})).json.others).toEqual([]);
  });

  it('webhook config, secret and log are for editors only', async () => {
    const put = await editor.request('PUT', path('/webhook'), {enabled: true, url: 'https://user:pass@hooks.example.com/hook'});
    expect(put.status).toBe(422);
    const ok = await editor.request('PUT', path('/webhook'), {enabled: true, url: 'https://hooks.example.com/hook'});
    expect(ok.json).toMatchObject({hasSecret: false, webhook: {enabled: true, url: 'https://hooks.example.com/hook'}});
    const secret = await editor.post(path('/webhook/secret'));
    expect(String(secret.json.secret)).toMatch(/^whsec_/);
    expect((await editor.get(path('/webhook'))).json.hasSecret).toBe(true);
    expect((await editor.get(path('/webhook/deliveries'))).json.deliveries).toEqual([]);
    const off = await editor.delete(path('/webhook'));
    expect(off.json).toMatchObject({hasSecret: false, webhook: {enabled: false, url: null}});
    expect((await editor.post(path('/webhook/test'))).json.error).toBe('webhook_not_configured');
  });

  it('never resends a real response to the old URL once the webhook is removed', async () => {
    await patch(editor, {draft: {layout: 'all_at_once', fields: [{id: 'f_name0001', type: 'short_text', label: 'Name', props: {}}]}});
    expect((await editor.post(path('/publish'))).status).toBe(200);
    const form = await db.form.findUniqueOrThrow({where: {id: formId}, select: {publishedVersionId: true}});
    const response = await db.response.create({
      data: {formId, formVersionId: form.publishedVersionId!, answers: {f_name0001: 'Ada'}},
      select: {id: true},
    });
    expect((await editor.request('PUT', path('/webhook'), {enabled: true, url: 'https://hooks.example.com/old'})).status).toBe(200);
    // A real delivery in the log, and one still queued, both for the URL being removed.
    const logged = await db.webhookDelivery.create({
      data: {formId, responseId: response.id, url: 'https://hooks.example.com/old', webhookId: `msg_${response.id}`, isTest: false,
        payload: {type: 'response.created', answers: {f_name0001: {value: 'Ada'}}}, statusCode: 500, durationMs: 5, error: 'The endpoint answered 500'},
      select: {id: true},
    });
    const queued = await insertDelivery(db, {formId, responseId: response.id, payload: {type: 'response.created'}, isTest: false, url: 'https://hooks.example.com/old'});
    expect((await editor.delete(path('/webhook'))).status).toBe(200);

    const sent: string[] = [];
    const fetchSpy = (async (input: RequestInfo | URL) => {
      sent.push(String(input));
      return new Response('ok');
    }) as typeof fetch;
    const before = await db.webhookDelivery.count({where: {formId}});
    const resend = await editor.post(path(`/webhook/deliveries/${logged.id}/resend`));
    expect(resend.status).toBe(422);
    expect(resend.json).toMatchObject({error: 'webhook_disabled', message: 'The webhook is turned off for this form'});
    expect(await db.webhookDelivery.count({where: {formId}})).toBe(before);

    // The job of the delivery queued before the removal records why, and sends nothing.
    expect(await runDelivery(db, queued.deliveryId, {fetch: fetchSpy})).toMatchObject({ok: false, error: 'The webhook is turned off for this form'});
    expect(sent).toEqual([]);
    // And the removed webhook's secret was not brought back.
    expect((await db.form.findUniqueOrThrow({where: {id: formId}, select: {webhookSecret: true}})).webhookSecret).toBeNull();
    const row = await db.webhookDelivery.findUniqueOrThrow({where: {id: queued.deliveryId}, select: {error: true, url: true}});
    expect(row).toEqual({error: 'The webhook is turned off for this form', url: 'https://hooks.example.com/old'});
  });

  it('shows a delivery that never finished as failed, not pending', async () => {
    expect((await editor.request('PUT', path('/webhook'), {enabled: true, url: 'https://hooks.example.com/hook'})).status).toBe(200);
    const stuck = await insertDelivery(db, {formId, responseId: null, payload: {type: 'response.test'}, isTest: true, url: 'https://hooks.example.com/hook'});
    await db.webhookDelivery.update({where: {id: stuck.deliveryId}, data: {createdAt: new Date(Date.now() - 20 * 60_000)}, select: {id: true}});
    const one = await editor.get(path(`/webhook/deliveries/${stuck.deliveryId}`));
    expect(one.json.delivery).toMatchObject({pending: false, ok: false, error: 'This delivery never finished. Resend it.'});
  });
});
