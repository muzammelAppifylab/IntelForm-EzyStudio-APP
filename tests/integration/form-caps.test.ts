import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {cache} from '../../src/platform/cache';
import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {app} from '../../src/server/app';
import {clearPublicFormCacheFor, clearPublicFormSlugs, loadPublishedBySlug} from '../../src/server/intelform/respondent/cache';
import {Browser, LOOSE_LIMITS, looseSiteLimits, renderTokenAt, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * Response caps as ONE statement on the form's form_caps row (submit.ts cappedInsertSql, the
 * 20261119140000_form_caps migration), against a real Postgres: exact under a burst, a retried
 * fill takes no slot, a deleted response frees one, the owner's cap changes are followed, and
 * the published-form cache is cleared per slug. Runs only with TEST_DATABASE_URL.
 */
const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [{id: 'f_name', type: 'short_text', label: 'Your name', required: true}],
});

let seq = 0;
async function makeForm(settings: Record<string, unknown> = {}) {
  const slug = `cap-${++seq}`;
  const s = {...defaultFormSettings(), ...LOOSE_LIMITS, ...settings};
  const form = await db.form.create({
    data: {slug, title: `Cap ${seq}`, status: 'live', draft: DEF as never, settings: s as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  const v = await db.formVersion.create({data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never}, select: {id: true}});
  await db.form.update({where: {id: form.id}, data: {publishedVersionId: v.id}, select: {id: true}});
  return {id: form.id, slug, versionId: v.id};
}

type Form = Awaited<ReturnType<typeof makeForm>>;

async function body(form: Form, extra: Record<string, unknown> = {}, ip = '203.0.113.10') {
  return {
    formVersionId: form.versionId,
    answers: {f_name: 'Ada'},
    renderToken: await renderTokenAt(SECRET, form.id, ip),
    startedAt: Date.now() - 4000,
    ...extra,
  };
}

const sid = (n: number) => `fill-${String(n).padStart(4, '0')}-capcapcapcapcap`;
/** A submit, with the page's render token in the header every respondent write carries. */
async function post(form: Form, n: number | null, ip = '203.0.113.10') {
  const b = await body(form, n === null ? {} : {submissionId: sid(n)}, ip);
  return new Browser(app, ip).request('POST', `/site-api/public/forms/${form.slug}/responses`, b, {'x-intelform-render': b.renderToken});
}

async function state(formId: string) {
  const [row] = await db.$queryRaw<{rows: number; taken: number | null; cap: number | null; status: string}[]>`
    SELECT (SELECT count(*)::int FROM responses WHERE form_id = ${formId}::uuid) AS rows,
      (SELECT taken FROM form_caps WHERE form_id = ${formId}::uuid) AS taken,
      (SELECT cap FROM form_caps WHERE form_id = ${formId}::uuid) AS cap,
      (SELECT status FROM forms WHERE id = ${formId}::uuid) AS status
  `;
  return row!;
}

/** The owner's change, as the settings save makes it (the route also clears the cache). */
async function setSettings(form: Form, patch: Record<string, unknown>, status?: 'live' | 'closed') {
  await db.$executeRaw`UPDATE forms SET settings = settings || ${JSON.stringify(patch)}::jsonb, status = coalesce(${status ?? null}, status) WHERE id = ${form.id}::uuid`;
  await clearPublicFormCacheFor(db, form.id);
}

describe.skipIf(!DATABASE_URL)('response caps on form_caps (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await looseSiteLimits();
  });

  it('a cap of N under 3N parallel submits takes exactly N and closes the form', async () => {
    const N = 10;
    const form = await makeForm({responseCap: N});
    const results = await Promise.all(Array.from({length: 3 * N}, (_, i) => post(form, 100 + i, `203.0.113.${(i % 200) + 1}`)));
    expect(results.filter(r => r.status === 200)).toHaveLength(N);
    expect(results.filter(r => r.status === 403)).toHaveLength(2 * N);
    expect(await state(form.id)).toEqual({rows: N, taken: N, cap: N, status: 'closed'});
    // Closing at the cap cleared the cached form: the page says closed.
    expect((await new Browser(app).get(`/site-api/public/forms/${form.slug}`)).json.status).toBe('closed');
  });

  it('a retried fill takes no slot, in sequence and in parallel', async () => {
    const form = await makeForm({responseCap: 3});
    expect((await post(form, 1)).status).toBe(200);
    expect((await post(form, 1)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 1, taken: 1, cap: 3, status: 'live'});

    const race = await Promise.all(Array.from({length: 8}, (_, i) => post(form, 2, `203.0.113.${50 + i}`)));
    expect(race.map(r => r.status)).toEqual(Array(8).fill(200));
    expect(await state(form.id)).toEqual({rows: 2, taken: 2, cap: 3, status: 'live'});

    expect((await post(form, 3)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 3, taken: 3, cap: 3, status: 'closed'});
    // The fill that took the last slot, retried after the form closed: still a success.
    expect((await post(form, 3)).json).toEqual({ok: true});
    expect((await post(form, 4)).status).toBe(403);
  });

  it('starts from the exact count of responses saved before the cap was set', async () => {
    const form = await makeForm();
    for (let i = 0; i < 3; i++) expect((await post(form, 10 + i)).status).toBe(200);
    expect((await state(form.id)).taken).toBeNull();
    await setSettings(form, {responseCap: 4});
    expect((await post(form, 20)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 4, taken: 4, cap: 4, status: 'closed'});
  });

  it('a deleted response on a full capped form frees its slot', async () => {
    const form = await makeForm({responseCap: 2});
    expect((await post(form, 1)).status).toBe(200);
    expect((await post(form, 2)).status).toBe(200);
    expect((await state(form.id)).status).toBe('closed');
    await db.$executeRaw`DELETE FROM responses WHERE form_id = ${form.id}::uuid AND submission_id = ${sid(1)}`;
    expect((await state(form.id)).taken).toBe(1);
    // The owner reopens it (the reopen route refuses only a form at its cap).
    await setSettings(form, {}, 'live');
    expect((await post(form, 3)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 2, taken: 2, cap: 2, status: 'closed'});
    expect((await post(form, 4)).status).toBe(403);
  });

  it('follows the owner raising, lowering and removing the cap', async () => {
    const form = await makeForm({responseCap: 2});
    expect((await post(form, 1)).status).toBe(200);
    expect((await post(form, 2)).status).toBe(200);
    expect((await state(form.id)).status).toBe('closed');

    // Raised and reopened: one more slot.
    await setSettings(form, {responseCap: 3}, 'live');
    expect((await post(form, 3)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 3, taken: 3, cap: 3, status: 'closed'});

    // Raised to 10, then lowered below the count while live: refused, nothing saved.
    await setSettings(form, {responseCap: 10}, 'live');
    expect((await post(form, 4)).status).toBe(200);
    await setSettings(form, {responseCap: 2});
    expect((await post(form, 5)).status).toBe(403);
    expect((await state(form.id)).rows).toBe(4);

    // Lowered WITHOUT a cache clear (the cached shape still says 10): the statement refuses it.
    await db.$executeRaw`UPDATE forms SET settings = settings || '{"responseCap": 4}'::jsonb WHERE id = ${form.id}::uuid`;
    expect((await post(form, 6)).status).toBe(403);

    // Removed: uncapped again, and the form_caps row goes with the next submit.
    await setSettings(form, {responseCap: null});
    expect((await post(form, 7)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 5, taken: null, cap: null, status: 'live'});

    // Set again later: counted from the exact count.
    await setSettings(form, {responseCap: 6});
    expect((await post(form, 8)).status).toBe(200);
    expect(await state(form.id)).toEqual({rows: 6, taken: 6, cap: 6, status: 'closed'});
  });

  it('a cap added after the form was cached is still enforced (the statement re-checks it)', async () => {
    const form = await makeForm();
    expect((await post(form, 1)).status).toBe(200);
    await db.$executeRaw`UPDATE forms SET settings = settings || '{"responseCap": 1}'::jsonb WHERE id = ${form.id}::uuid`;
    expect((await post(form, 2)).status).toBe(403);
    expect((await state(form.id)).rows).toBe(1);
  });

  it('a capped form is cached without its count; the page reads the count exactly', async () => {
    const form = await makeForm({responseCap: 1});
    const visitor = new Browser(app);
    expect((await visitor.get(`/site-api/public/forms/${form.slug}`)).json.status).toBe('live');
    expect(await cache.get(`form:slug:${form.slug}`)).not.toBeNull();
    // A response lands without closing the form (status kept live by hand): the count says closed.
    await db.$executeRaw`INSERT INTO responses (form_id, form_version_id, answers) VALUES (${form.id}::uuid, ${form.versionId}::uuid, '{}'::jsonb)`;
    expect((await visitor.get(`/site-api/public/forms/${form.slug}`)).json.status).toBe('closed');
  });

  it('a password form is cached without its hash; the locked screen needs no definition', async () => {
    const form = await makeForm();
    await db.$executeRaw`UPDATE forms SET settings = settings || '{"passwordHash": "x"}'::jsonb WHERE id = ${form.id}::uuid`;
    const res = await new Browser(app).get(`/site-api/public/forms/${form.slug}`);
    expect(res.json.status).toBe('locked');
    expect(res.json.definition).toBeUndefined();
    const cached = JSON.stringify(await cache.get(`form:slug:${form.slug}`));
    expect(cached).toContain('"hasPassword":true');
    expect(cached).not.toContain('passwordHash');
    // From the cache, still locked; a submit without the token is refused.
    expect((await new Browser(app).get(`/site-api/public/forms/${form.slug}`)).json.status).toBe('locked');
    expect((await post(form, 1)).status).toBe(401);
  });

  it('clears the cached form per slug: its own slug and the one it was renamed from, never others', async () => {
    const a = await makeForm();
    const b = await makeForm();
    await loadPublishedBySlug(db, a.slug);
    await loadPublishedBySlug(db, b.slug);
    expect(await cache.get(`form:slug:${a.slug}`)).not.toBeNull();
    expect(await cache.get(`form:slug:${b.slug}`)).not.toBeNull();

    // A rename, as the autosave makes it: the old slug is kept as a redirect.
    await db.$executeRaw`UPDATE forms SET slug = ${`${a.slug}-new`} WHERE id = ${a.id}::uuid`;
    await db.$executeRaw`INSERT INTO form_slugs_old (slug, form_id) VALUES (${a.slug}, ${a.id}::uuid)`;
    await loadPublishedBySlug(db, `${a.slug}-new`);
    await clearPublicFormCacheFor(db, a.id);
    expect(await cache.get(`form:slug:${a.slug}`)).toBeNull();
    expect(await cache.get(`form:slug:${a.slug}-new`)).toBeNull();
    expect(await cache.get(`form:slug:${b.slug}`)).not.toBeNull();
    expect(await loadPublishedBySlug(db, a.slug)).toEqual({kind: 'moved', slug: `${a.slug}-new`});

    await clearPublicFormSlugs(b.slug.toUpperCase());
    expect(await cache.get(`form:slug:${b.slug}`)).toBeNull();
  });
});
