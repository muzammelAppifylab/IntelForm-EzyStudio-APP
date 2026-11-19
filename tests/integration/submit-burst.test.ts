import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {app} from '../../src/server/app';
import {renderToken} from '../../src/server/intelform/respondent/tokens';
import {Browser, LOOSE_LIMITS, looseSiteLimits, renderTokenAt, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * Burst-safe submits (src/server/intelform/respondent/submit.ts) against a real Postgres: an
 * uncapped form's row is never written, a retried fill (same submissionId) is saved once and
 * answered with success, a cap stays exact, the notify work is queued in the same statement,
 * and many people behind one address are not limited as one. Runs only with TEST_DATABASE_URL.
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
async function makeForm(settings: Record<string, unknown> = {}) {
  const slug = `b-${++seq}`;
  const s = {...defaultFormSettings(), ...LOOSE_LIMITS, ...settings};
  const form = await db.form.create({
    data: {slug, title: `Burst ${seq}`, status: 'live', draft: DEF as never, settings: s as never, theme: defaultTheme() as never},
    select: {id: true, updatedAt: true},
  });
  const v = await db.formVersion.create({
    data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  await db.form.update({where: {id: form.id}, data: {publishedVersionId: v.id}, select: {id: true}});
  return {id: form.id, slug, versionId: v.id};
}

async function body(form: {id: string; versionId: string}, extra: Record<string, unknown> = {}) {
  return {
    formVersionId: form.versionId,
    answers: {f_name: {first: 'Ada', last: 'Lovelace'}, f_email: 'ada@example.com'},
    renderToken: await renderToken(SECRET, form.id, Date.now() - 5000),
    startedAt: Date.now() - 4000,
    ...extra,
  };
}

const sid = (n: number) => `fill-${String(n).padStart(4, '0')}-abcdefghijklmn`;
// Respondent writes carry the page's render token in a header (no CSRF cookie: embeds).
// Each post is a page load at `ip`: its render token is bound to that address.
const post = async (form: {id: string; slug: string}, b: Record<string, unknown>, ip = '203.0.113.10') => {
  const token = await renderTokenAt(SECRET, form.id, ip);
  return new Browser(app, ip).request('POST', `/site-api/public/forms/${form.slug}/responses`, {...b, renderToken: token}, {
    'x-intelform-render': token,
  });
};

async function counts(formId: string) {
  const [row] = await db.$queryRaw<{responses: number; queued: number; rows: number}[]>`
    SELECT
      (SELECT coalesce(sum(responses), 0)::int FROM form_counts WHERE form_id = ${formId}::uuid) AS responses,
      (SELECT count(*)::int FROM intelform_notify_queue q JOIN responses r ON r.id = q.response_id WHERE r.form_id = ${formId}::uuid) AS queued,
      (SELECT count(*)::int FROM responses WHERE form_id = ${formId}::uuid) AS rows
  `;
  return row!;
}

describe.skipIf(!DATABASE_URL)('burst-safe submits (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await looseSiteLimits();
  });

  it('an uncapped form: saved without writing the form row; notify work queued only when needed', async () => {
    const quiet = await makeForm();
    const before = await db.form.findUniqueOrThrow({where: {id: quiet.id}, select: {updatedAt: true, responseCount: true}});
    expect((await post(quiet, await body(quiet, {submissionId: sid(1)}))).json).toEqual({ok: true});
    expect(await db.form.findUniqueOrThrow({where: {id: quiet.id}, select: {updatedAt: true, responseCount: true}})).toEqual(before);
    expect(await counts(quiet.id)).toEqual({responses: 1, queued: 0, rows: 1});

    const loud = await makeForm({notifyOnResponse: true});
    expect((await post(loud, await body(loud))).status).toBe(200);
    expect(await counts(loud.id)).toEqual({responses: 1, queued: 1, rows: 1});
  });

  it('a form whose stored settings lack responseCap still saves (not a silent success)', async () => {
    const form = await makeForm();
    await db.$executeRaw`UPDATE forms SET settings = settings - 'responseCap' WHERE id = ${form.id}::uuid`;
    expect((await post(form, await body(form, {submissionId: sid(9)}))).json).toEqual({ok: true});
    expect((await post(form, await body(form))).json).toEqual({ok: true});
    expect(await counts(form.id)).toEqual({responses: 2, queued: 0, rows: 2});
  });

  it('a retried fill is saved once and answered like the first time, also in parallel', async () => {
    const form = await makeForm({notifyOnResponse: true, afterSubmit: 'redirect', redirectUrl: 'https://example.com/done'});
    const first = await post(form, await body(form, {submissionId: sid(2)}));
    const again = await post(form, await body(form, {submissionId: sid(2)}));
    expect(first.json).toEqual({ok: true, redirectUrl: 'https://example.com/done'});
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await counts(form.id)).toEqual({responses: 1, queued: 1, rows: 1});

    const b = await body(form, {submissionId: sid(3)});
    const race = await Promise.all(Array.from({length: 6}, (_, i) => post(form, b, `203.0.113.${100 + i}`)));
    expect(race.map(r => r.status)).toEqual(Array(6).fill(200));
    expect(await counts(form.id)).toEqual({responses: 2, queued: 2, rows: 2});
  });

  it('a capped form stays exact under parallel submits; a retry takes no slot and never closes it', async () => {
    const form = await makeForm({responseCap: 3});
    const results = await Promise.all(
      Array.from({length: 8}, async (_, i) => post(form, await body(form, {submissionId: sid(10 + i)}), `203.0.113.${20 + i}`))
    );
    expect(results.filter(r => r.status === 200)).toHaveLength(3);
    expect(results.filter(r => r.status === 403)).toHaveLength(5);
    expect((await counts(form.id)).rows).toBe(3);
    expect((await db.form.findUniqueOrThrow({where: {id: form.id}, select: {status: true}})).status).toBe('closed');

    const two = await makeForm({responseCap: 2});
    expect((await post(two, await body(two, {submissionId: sid(30)}))).status).toBe(200);
    expect((await post(two, await body(two, {submissionId: sid(30)}))).status).toBe(200);
    expect((await counts(two.id)).rows).toBe(1);
    expect((await db.form.findUniqueOrThrow({where: {id: two.id}, select: {status: true}})).status).toBe('live');
    expect((await post(two, await body(two, {submissionId: sid(31)}))).status).toBe(200);
    expect((await db.form.findUniqueOrThrow({where: {id: two.id}, select: {status: true}})).status).toBe('closed');
    // The fill that took the last slot, retried after the form closed: still a success.
    expect((await post(two, await body(two, {submissionId: sid(31)}))).json).toEqual({ok: true});
    expect((await post(two, await body(two, {submissionId: sid(32)}))).status).toBe(403);
    expect((await counts(two.id)).rows).toBe(2);
  });

  it('a cap added after the form was loaded is still enforced', async () => {
    const form = await makeForm();
    expect((await post(form, await body(form))).status).toBe(200);
    // The settings change lands in the row; the submit path finds the cap in the statement.
    await db.$executeRaw`UPDATE forms SET settings = settings || '{"responseCap": 1}'::jsonb WHERE id = ${form.id}::uuid`;
    const res = await post(form, await body(form));
    expect(res.status).toBe(403);
    expect((await counts(form.id)).rows).toBe(1);
  });

  it('many people behind one address are not limited as one; one browser is', async () => {
    const form = await makeForm();
    const shared: number[] = [];
    for (let i = 0; i < 12; i++) shared.push((await post(form, await body(form, {browserToken: `browser-${i}`}), '203.0.113.60')).status);
    expect(shared.every(s => s === 200)).toBe(true);

    const one: number[] = [];
    for (let i = 0; i < 11; i++) one.push((await post(form, await body(form, {browserToken: 'same-browser'}), `203.0.113.${70 + i}`)).status);
    expect(one.slice(0, 10).every(s => s === 200)).toBe(true);
    expect(one[10]).toBe(429);
  });
});
