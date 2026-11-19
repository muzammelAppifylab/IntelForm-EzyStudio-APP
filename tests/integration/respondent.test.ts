import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {hashPassword} from '../../src/platform/auth/password';
import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {app} from '../../src/server/app';
import {ipKeyFor} from '../../src/server/intelform/respondent/crypto';
import {renderToken} from '../../src/server/intelform/respondent/tokens';
import {syncFormCounts} from '../../src/server/intelform/forms/counts';
import {UNLOCK_ATTACK_IP_FAILURES, UNLOCK_FORM_FAILURE_LIMIT, UNLOCK_IP_FAILURE_LIMIT} from '../../src/server/routes/public-forms';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The respondent API (/site-api/public/forms) end to end against a real Postgres: load by slug
 * (and an old slug), submit with every check, the funnel events, the form password. Anonymous:
 * no sign-in anywhere here. Runs only with TEST_DATABASE_URL (it empties the tables).
 */
const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [
    {id: 'f_name', type: 'name', label: 'Your name', required: true, props: {split: true}},
    {id: 'f_email', type: 'email', label: 'Email', required: true},
  ],
});

let seq = 0;
async function makeForm(settings: Record<string, unknown> = {}, status = 'live') {
  const slug = `t-${++seq}`;
  const s = {...defaultFormSettings(), ...settings};
  const form = await db.form.create({
    data: {slug, title: `Survey ${seq}`, status, draft: DEF as never, settings: s as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  const v = await db.formVersion.create({
    data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  await db.form.update({where: {id: form.id}, data: {publishedVersionId: v.id}, select: {id: true}});
  return {id: form.id, slug, versionId: v.id};
}

/**
 * A respondent write as the browser sends it: with the page's render token in its header (the
 * routes sit before csrf for embedded forms and check that token: src/server/routes/public-forms.ts).
 */
async function rpost(b: Browser, form: {id: string; slug: string}, op: 'responses' | 'events' | 'unlock', body: unknown) {
  return b.request('POST', `/site-api/public/forms/${form.slug}/${op}`, body, {'x-intelform-render': await renderToken(SECRET, form.id)});
}

const good = {f_name: {first: 'Ada', last: 'Lovelace'}, f_email: 'ada@example.com'};
async function submitBody(form: {id: string; versionId: string}, extra: Record<string, unknown> = {}) {
  return {formVersionId: form.versionId, answers: good, renderToken: await renderToken(SECRET, form.id, Date.now() - 5000), startedAt: Date.now() - 4000, ...extra};
}

describe.skipIf(!DATABASE_URL)('respondent API (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);

  it('loads a live form, follows an old slug, hides drafts', async () => {
    const form = await makeForm();
    const visitor = new Browser(app);
    const live = await visitor.get(`/site-api/public/forms/${form.slug}`);
    expect(live.status).toBe(200);
    expect(live.json).toMatchObject({status: 'live', id: form.id, versionId: form.versionId});
    expect(String(live.json.renderToken)).toMatch(/^\d+\./);
    expect(live.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(live.json)).not.toContain('passwordHash');

    await db.formSlugOld.create({data: {slug: 'old-name', formId: form.id}});
    expect((await visitor.get('/site-api/public/forms/old-name')).json).toEqual({status: 'moved', redirectTo: form.slug});

    const draft = await makeForm({}, 'draft');
    expect((await visitor.get(`/site-api/public/forms/${draft.slug}`)).status).toBe(404);
    expect((await visitor.get('/site-api/public/forms/no-such-form')).status).toBe(404);
  });

  it('saves a response, keeps the count, fills contacts by trigger', async () => {
    const form = await makeForm();
    const visitor = new Browser(app);
    const res = await rpost(visitor, form, 'responses', await submitBody(form));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ok: true});
    const rows = await db.response.findMany({where: {formId: form.id}, select: {answers: true, ipHash: true, contactEmail: true, searchText: true}});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.contactEmail).toBe('ada@example.com');
    // forms.response_count is the copy the every-minute sync refreshes from form_counts.
    await syncFormCounts(db);
    expect((await db.form.findUniqueOrThrow({where: {id: form.id}, select: {responseCount: true}})).responseCount).toBe(1);
  });

  it('refuses a write without the render-token header (it stands in for the CSRF token)', async () => {
    const form = await makeForm();
    const res = await new Browser(app).request('POST', `/site-api/public/forms/${form.slug}/responses`, await submitBody(form), {'x-csrf-token': ''});
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('page_invalid');
  });

  it('closes at the cap, exactly, under parallel submits', async () => {
    const form = await makeForm({responseCap: 3});
    const results = await Promise.all(
      Array.from({length: 6}, async (_, i) => rpost(new Browser(app, `203.0.113.${20 + i}`), form, 'responses', await submitBody(form)))
    );
    expect(results.filter(r => r.status === 200)).toHaveLength(3);
    expect(results.filter(r => r.status === 403)).toHaveLength(3);
    await syncFormCounts(db);
    const after = await db.form.findUniqueOrThrow({where: {id: form.id}, select: {status: true, responseCount: true}});
    expect(after).toEqual({status: 'closed', responseCount: 3});
  });

  it('one response per email, also in a race', async () => {
    const form = await makeForm({onePerEmail: true, onePerEmailFieldId: 'f_email'});
    const results = await Promise.all(
      [0, 1, 2].map(async i => rpost(new Browser(app, `203.0.113.${40 + i}`), form, 'responses', await submitBody(form)))
    );
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 422).every(r => (r.json.fields as Record<string, unknown>).f_email)).toBe(true);
    expect(await db.response.count({where: {formId: form.id}})).toBe(1);
  });

  it('rate limits submits per browser and form (the per-address ceiling is far higher: submit-burst.test.ts)', async () => {
    const form = await makeForm();
    const visitor = new Browser(app, '203.0.113.60');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await rpost(visitor, form, 'responses', await submitBody(form, {browserToken: 'one-browser'}))).status);
    }
    expect(statuses.slice(0, 10).every(s => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('counts views and starts once per session in 15-minute buckets', async () => {
    const form = await makeForm();
    const visitor = new Browser(app);
    const session = '6f1c1d2e-1111-4222-8333-444455556666';
    for (const type of ['view', 'view', 'start']) {
      expect((await rpost(visitor, form, 'events', {type, session})).status).toBe(204);
    }
    // Each event lands in one random shard of the 15-minute bucket: readers sum the shards.
    const counts = await db.formEventCount.findMany({where: {formId: form.id}, select: {bucket: true, views: true, starts: true}});
    expect(new Set(counts.map(c => c.bucket.getTime())).size).toBe(1);
    expect(counts.reduce((n, c) => ({views: n.views + c.views, starts: n.starts + c.starts}), {views: 0, starts: 0})).toEqual({views: 1, starts: 1});
    const starts = await db.formCount.aggregate({where: {formId: form.id}, _sum: {starts: true}});
    expect(starts._sum.starts).toBe(1);
  });

  it('a password-protected form unlocks with the right password only', async () => {
    const form = await makeForm({passwordHash: await hashPassword('open sesame')});
    const visitor = new Browser(app);
    expect((await visitor.get(`/site-api/public/forms/${form.slug}`)).json.status).toBe('locked');
    const wrong = await rpost(visitor, form, 'unlock', {password: 'nope'});
    expect(wrong.status).toBe(422);
    expect((await rpost(visitor, form, 'responses', await submitBody(form))).status).toBe(401);
    const right = await rpost(visitor, form, 'unlock', {password: 'open sesame'});
    expect(right.status).toBe(200);
    const token = String(right.json.token);
    expect((right.json.form as {status: string}).status).toBe('live');
    const res = await rpost(visitor, form, 'responses', await submitBody(form, {unlockToken: token}));
    expect(res.status).toBe(200);
  });

  // F-006: 100 wrong passwords from many addresses used to refuse even the RIGHT password for
  // everyone until the end of the hour.
  it('wrong passwords from many addresses never lock out a respondent with the right password', async () => {
    // The failure windows are fixed hours: don't straddle a boundary mid-test.
    const leftInHour = 3600_000 - (Date.now() % 3600_000);
    if (leftInHour < 90_000) await new Promise(r => setTimeout(r, leftInHour + 1000));
    const form = await makeForm({passwordHash: await hashPassword('open sesame')});
    const unlock = (ip: string, password: string) => rpost(new Browser(app, ip), form, 'unlock', {password});

    const attack = await Promise.all(
      Array.from({length: 10}, async (_, i) => {
        const statuses: number[] = [];
        for (let n = 0; n < 10; n++) statuses.push((await unlock(`198.51.100.${10 + i}`, `guess-${i}-${n}`)).status);
        return statuses;
      })
    );
    expect(attack.flat().every(s => s === 422)).toBe(true);

    // A new address with the right password gets in.
    const right = await unlock('198.51.100.200', 'open sesame');
    expect(right.status).toBe(200);
    expect(typeof right.json.token).toBe('string');
    expect((right.json.form as {status: string}).status).toBe('live');

    // An 11th address may still try, but only a few wrong passwords while the form is under attack.
    const eleventh: number[] = [];
    for (let n = 0; n < 4; n++) eleventh.push((await unlock('198.51.100.201', `more-${n}`)).status);
    expect(eleventh).toEqual([422, 422, 422, 429]);

    // An attacking address is out of tries for the hour, even with the right password.
    expect((await unlock('198.51.100.10', 'open sesame')).status).toBe(429);
  }, 180_000);
  // F-006: right passwords never use up a caller's failure budget, and the hourly per-caller cap
  // holds in normal times too (counters seeded directly so the test needn't wait out the minute).
  it('form password: successes cost nothing under attack; each caller has an hourly failure cap', async () => {
    const leftInHour = 3600_000 - (Date.now() % 3600_000);
    if (leftInHour < 60_000) await new Promise(r => setTimeout(r, leftInHour + 1000));
    const form = await makeForm({passwordHash: await hashPassword('open sesame')});
    const unlock = (ip: string, password: string) => rpost(new Browser(app, ip), form, 'unlock', {password});
    const seed = async (key: string, count: number) => {
      await db.$executeRaw`
        INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
        VALUES (${key}, date_bin(make_interval(secs => 3600), now(), 'epoch'), 3600, ${count})
        ON CONFLICT (key, window_start) DO UPDATE SET count = ${count}`;
    };

    // Normal times: 29 earlier wrong passwords from this caller, so one more is allowed, then 429
    // (even for the right password).
    const ip = '203.0.113.7';
    await seed(`unlock-fail:ip:${await ipKeyFor(SECRET, ip)}:${form.id}`, UNLOCK_IP_FAILURE_LIMIT - 1);
    expect((await unlock(ip, 'nope')).status).toBe(422);
    expect((await unlock(ip, 'open sesame')).status).toBe(429);

    // Under attack: a new caller's right password works every time; successes don't count.
    await seed(`unlock-fail:form:${form.id}`, UNLOCK_FORM_FAILURE_LIMIT);
    const fresh: number[] = [];
    for (let n = 0; n < UNLOCK_ATTACK_IP_FAILURES + 3; n++) fresh.push((await unlock('203.0.113.8', 'open sesame')).status);
    expect(fresh.every(s => s === 200)).toBe(true);
    // ...and that caller still has its few wrong tries left.
    const wrong: number[] = [];
    for (let n = 0; n <= UNLOCK_ATTACK_IP_FAILURES; n++) wrong.push((await unlock('203.0.113.8', `x${n}`)).status);
    expect(wrong).toEqual([...Array(UNLOCK_ATTACK_IP_FAILURES).fill(422), 429]);
  });
});
