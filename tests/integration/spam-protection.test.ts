import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {app} from '../../src/server/app';
import {autoBlock} from '../../src/server/intelform/abuse/blocks';
import {ipKeyFor} from '../../src/server/intelform/respondent/crypto';
import {
  Browser,
  configureEnv,
  DATABASE_URL,
  db,
  ownerSignedIn,
  renderTokenAt,
  resetDatabase,
  signedIn,
  userId,
} from './support/harness';

/**
 * Spam protection end to end against a real Postgres (src/lib/intelform/spam.ts,
 * src/server/intelform/respondent/submit.ts gate, src/server/intelform/abuse/): the default
 * limits per network, per form and per site; one response per page load; the block list and its
 * escalation; a response cap a flood can't use up; the Blocked visitors screen's routes; the
 * read-only demo role. Runs only with TEST_DATABASE_URL.
 */
const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [{id: 'f_email', type: 'email', label: 'Email', required: true}],
});

let seq = 0;
async function makeForm(settings: Record<string, unknown> = {}) {
  const slug = `spam-${++seq}`;
  const s = {...defaultFormSettings(), ...settings};
  const form = await db.form.create({
    data: {slug, title: `Spam ${seq}`, status: 'live', draft: DEF as never, settings: s as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  const v = await db.formVersion.create({data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never}, select: {id: true}});
  await db.form.update({where: {id: form.id}, data: {publishedVersionId: v.id}, select: {id: true}});
  return {id: form.id, slug, versionId: v.id};
}
type Form = Awaited<ReturnType<typeof makeForm>>;

let fill = 0;
/** One page load and its submit, from `ip`. */
async function submit(form: Form, ip = '203.0.113.10', extra: Record<string, unknown> = {}) {
  const token = (extra.renderToken as string | undefined) ?? (await renderTokenAt(SECRET, form.id, ip));
  const body = {
    formVersionId: form.versionId,
    answers: {f_email: `p${++fill}@example.com`},
    renderToken: token,
    startedAt: Date.now() - 4000,
    submissionId: `fill-${String(fill).padStart(6, '0')}-spamspamspam`,
    ...extra,
  };
  return new Browser(app, ip).request('POST', `/site-api/public/forms/${form.slug}/responses`, body, {'x-intelform-render': token});
}

const rows = (formId: string) => db.response.count({where: {formId}});
const audits = (action: string) => db.auditEvent.count({where: {action}});

describe.skipIf(!DATABASE_URL)('spam protection (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);

  it('per network: 5 an hour by default, then refused, then blocked after 3 refusals; others are not affected', async () => {
    const form = await makeForm();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await submit(form, '198.51.100.7')).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    expect(await rows(form.id)).toBe(5);

    const key = await ipKeyFor(SECRET, '198.51.100.7');
    const block = await db.intelformBlockedIp.findUniqueOrThrow({where: {ipKey: key}, select: {reason: true, blocks: true, ipBlock: true, hits: true, expiresAt: true}});
    expect(block).toMatchObject({reason: 'limits', blocks: 1, ipBlock: '198.51.100.7', hits: 3});
    expect(block.expiresAt.getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(await audits('visitor_blocked')).toBe(1);

    // Blocked: refused at once, nothing counted, even on another form.
    const other = await makeForm();
    const refused = await submit(other, '198.51.100.7');
    expect(refused.status).toBe(429);
    expect(refused.json.message).toMatch(/paused/);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(3000);
    expect(await rows(other.id)).toBe(0);

    // Another network still gets in; the same /64 of IPv6 is one network.
    expect((await submit(form, '198.51.100.8')).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await submit(other, `2001:db8:5:6::${i + 1}`)).status).toBe(200);
    expect((await submit(other, '2001:db8:5:6:ffff::1')).status).toBe(429);
  });

  it('per network: the day limit, and a form owner can raise the limits', async () => {
    const form = await makeForm({spamIpPerHour: 4, spamIpPerDay: 6});
    // Earlier hours of today used 5 of the 6.
    const key = await ipKeyFor(SECRET, '203.0.113.50');
    await db.$executeRaw`
      INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
      VALUES (${`respond-d:${key}:${form.id}`}, date_bin(make_interval(secs => 86400), now(), 'epoch'), 86400, 5)`;
    expect((await submit(form, '203.0.113.50')).status).toBe(200);
    const day = await submit(form, '203.0.113.50');
    expect(day.status).toBe(429);
    expect(Number(day.headers.get('retry-after'))).toBeGreaterThan(0);

    // A class on one network: the owner raises the limit and 30 people respond.
    const school = await makeForm({spamIpPerHour: 40, spamIpPerDay: 100});
    for (let i = 0; i < 30; i++) expect((await submit(school, '203.0.113.60')).status).toBe(200);
  });

  it('per form: 60 a minute by default across every network; the owner hears once', async () => {
    const form = await makeForm({spamFormPerMinute: 3});
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await submit(form, `192.0.2.${i + 1}`)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
    expect(await rows(form.id)).toBe(3);
    // Logged once for the hour, never per refusal, and no network is blocked for it.
    expect(await audits('spam_limit_reached')).toBe(1);
    expect(await db.intelformBlockedIp.count()).toBe(0);
    expect(defaultFormSettings().spamFormPerMinute).toBe(60);
  });

  it('a flood from one network does not use up the form’s share for everyone else', async () => {
    const form = await makeForm({spamFormPerMinute: 8});
    for (let i = 0; i < 12; i++) await submit(form, '198.51.100.99');
    // 5 saved from the flood, its refusals counted nothing on the form: 3 others still get in.
    for (let i = 0; i < 3; i++) expect((await submit(form, `192.0.2.${50 + i}`)).status).toBe(200);
  });

  it('per site: a ceiling across every form (300 a minute by default)', async () => {
    const owner = await ownerSignedIn(app);
    expect((await owner.request('PATCH', '/site-api/app-settings', {spam: {sitePerMinute: 10}})).status).toBe(200);
    const a = await makeForm();
    const b = await makeForm();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await submit(i % 2 ? a : b, `192.0.2.${100 + i}`)).status);
    expect(statuses.filter(s => s === 200)).toHaveLength(10);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('a render token saves one response; a retry of the same fill is still a success', async () => {
    const form = await makeForm();
    const token = await renderTokenAt(SECRET, form.id);
    const first = await submit(form, undefined, {renderToken: token, submissionId: 'fill-a-0000000000000001'});
    expect(first.status).toBe(200);
    const again = await submit(form, undefined, {renderToken: token, submissionId: 'fill-a-0000000000000001'});
    expect(again.json).toEqual({ok: true});
    const replay = await submit(form, undefined, {renderToken: token, submissionId: 'fill-b-0000000000000002'});
    expect(replay.status).toBe(409);
    expect(replay.json.error).toBe('page_expired');
    // Replays in parallel: still one saved response.
    const t2 = await renderTokenAt(SECRET, form.id);
    const race = await Promise.all(Array.from({length: 4}, (_, i) => submit(form, undefined, {renderToken: t2, submissionId: `fill-race-00000000000${i}`})));
    expect(race.filter(r => r.status === 200)).toHaveLength(1);
    expect(await rows(form.id)).toBe(2);
    // A token handed to another network: reload (the answers are kept), nothing saved.
    const moved = await submit(form, '203.0.113.11', {renderToken: await renderTokenAt(SECRET, form.id, '203.0.113.12')});
    expect(moved.status).toBe(409);
    expect(await rows(form.id)).toBe(2);
  });

  it('blocks escalate 1 hour, 24 hours, 7 days; a block in force is not extended', async () => {
    const form = await makeForm();
    const input = {ipKey: 'k'.repeat(40), ipBlock: '203.0.113.200', formId: form.id, strikes: 3};
    const hours = async () => {
      const r = await db.intelformBlockedIp.findUniqueOrThrow({where: {ipKey: input.ipKey}, select: {expiresAt: true}});
      return Math.round((r.expiresAt.getTime() - Date.now()) / 3600_000);
    };
    expect(await autoBlock(db, input)).toMatchObject({fresh: true, step: 1});
    expect(await hours()).toBe(1);
    expect(await autoBlock(db, input)).toMatchObject({fresh: false, step: 1});
    expect(await hours()).toBe(1);
    await db.intelformBlockedIp.update({where: {ipKey: input.ipKey}, data: {expiresAt: new Date(Date.now() - 1000)}, select: {ipKey: true}});
    expect(await autoBlock(db, input)).toMatchObject({fresh: true, step: 2});
    expect(await hours()).toBe(24);
    await db.intelformBlockedIp.update({where: {ipKey: input.ipKey}, data: {expiresAt: new Date(Date.now() - 1000)}, select: {ipKey: true}});
    expect(await autoBlock(db, input)).toMatchObject({fresh: true, step: 3});
    expect(await hours()).toBe(168);
    // Forgotten 30 days after a block ends (the next block removes it): it starts again at 1 hour.
    await db.intelformBlockedIp.update({where: {ipKey: input.ipKey}, data: {expiresAt: new Date(Date.now() - 31 * 86_400_000)}, select: {ipKey: true}});
    await autoBlock(db, {...input, ipKey: 'z'.repeat(40)});
    expect(await db.intelformBlockedIp.count({where: {ipKey: input.ipKey}})).toBe(0);
  });

  it('a capped form: a flood from one network can’t fill the cap or close the form', async () => {
    const form = await makeForm({responseCap: 10});
    const results = await Promise.all(Array.from({length: 40}, () => submit(form, '198.51.100.40')));
    expect(results.filter(r => r.status === 200)).toHaveLength(5);
    expect(await rows(form.id)).toBe(5);
    expect((await db.form.findUniqueOrThrow({where: {id: form.id}, select: {status: true}})).status).toBe('live');
    // Real people from other networks still fill it, exactly.
    for (let i = 0; i < 6; i++) await submit(form, `192.0.2.${200 + i}`);
    expect(await rows(form.id)).toBe(10);
    expect((await db.form.findUniqueOrThrow({where: {id: form.id}, select: {status: true}})).status).toBe('closed');
  });

  it('confirmation emails: an address block gets at most 3 an hour (the 4th response is marked)', async () => {
    const form = await makeForm({confirmationEmail: true, confirmationEmailFieldId: 'f_email', spamIpPerHour: 10, spamIpPerDay: 10});
    for (let i = 0; i < 4; i++) expect((await submit(form, '203.0.113.77')).status).toBe(200);
    const marked = await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM intelform_done_markers WHERE key LIKE 'job:confirm-skip-ip:%'`;
    expect(marked[0]!.n).toBe(1);
    expect(await db.intelformNotifyQueue.count()).toBe(4);
  });

  it('Blocked visitors: admins see and change the list; others see it masked; the demo role changes nothing', async () => {
    const form = await makeForm();
    for (let i = 0; i < 8; i++) await submit(form, '198.51.100.7');
    const owner = await ownerSignedIn(app);
    const list = await owner.get('/site-api/blocked-visitors');
    expect(list.status).toBe(200);
    const page = list.json as {blocks: {id: string; address: string; reason: string; hits: number; form: {id: string}}[]; canManage: boolean};
    expect(page.canManage).toBe(true);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0]).toMatchObject({address: '198.51.100.7', reason: 'limits', hits: 3, form: {id: form.id}});

    // A teammate who can see forms but not change the settings: masked, no changes.
    const viewer = await signedIn(app, 'viewer@example.test', undefined, '203.0.113.31');
    const viewerRole = await db.role.findUniqueOrThrow({where: {slug: 'viewer'}, select: {id: true}});
    await db.userRole.create({data: {userId: await userId('viewer@example.test'), roleId: viewerRole.id}, select: {userId: true}});
    const masked = (await viewer.get('/site-api/blocked-visitors')).json as typeof page;
    expect(masked.canManage).toBe(false);
    expect(masked.blocks[0]!.address).toBe('198.51.•.•');
    expect((await viewer.request('DELETE', `/site-api/blocked-visitors/${page.blocks[0]!.id}`)).status).toBe(403);
    expect((await viewer.post('/site-api/blocked-visitors', {address: '203.0.113.1', length: 'day'})).status).toBe(403);

    // Add by hand (an inline error for a bad address), then unblock.
    const bad = await owner.post('/site-api/blocked-visitors', {address: 'not an ip', length: 'day'});
    expect(bad.status).toBe(422);
    expect((bad.json.fields as Record<string, string>).address).toMatch(/IP address/);
    expect((await owner.post('/site-api/blocked-visitors', {address: '2001:db8:9:9::5', length: 'hour'})).status).toBe(201);
    expect((await submit(form, '2001:db8:9:9:abcd::1')).status).toBe(429);
    expect((await owner.request('DELETE', `/site-api/blocked-visitors/${page.blocks[0]!.id}`)).status).toBe(200);
    // Unblocked: its strikes and counts go too, so it isn't refused (and blocked again) at once.
    expect((await submit(form, '198.51.100.7')).status).toBe(200);
    expect(await audits('visitor_unblocked')).toBe(1);
  });

  it('the read-only demo role: no export, preferences and presence store nothing', async () => {
    const form = await makeForm();
    const demo = await signedIn(app, 'demo@example.test', undefined, '203.0.113.41');
    const role = await db.role.upsert({
      where: {slug: 'demo-read-only'},
      create: {slug: 'demo-read-only', name: 'Demo (read-only)', description: 'Read only.', isSystem: false},
      update: {},
      select: {id: true},
    });
    const perms = await db.permission.findMany({
      where: {codename: {in: ['site:form:read', 'site:response:read', 'site:contact:read', 'site:audit:read']}},
      select: {id: true},
    });
    await db.rolePermission.createMany({data: perms.map(p => ({roleId: role.id, permissionId: p.id})), skipDuplicates: true});
    await db.userRole.create({data: {userId: await userId('demo@example.test'), roleId: role.id}, select: {userId: true}});

    const exp = await demo.post('/site-api/exports', {kind: 'responses', formId: form.id, query: {}});
    expect(exp.status).toBe(403);
    expect(await db.intelformExport.count()).toBe(0);

    expect((await demo.request('PATCH', '/site-api/forms/prefs/view', {view: 'grid'})).json).toEqual({view: 'grid'});
    expect(await db.userPref.count()).toBe(0);
    const put = await demo.request('PUT', `/site-api/responses/forms/${form.id}/responses/prefs`, {columns: [{id: 'f_email', visible: false}]});
    expect(put.status).toBe(200);
    expect(await db.responseTablePref.count()).toBe(0);
    expect((await demo.post(`/site-api/builder/forms/${form.id}/presence`, {tabId: 'tab-demo0001'})).status).toBe(200);
    expect(await db.formPresence.count()).toBe(0);

    // An admin still exports (the permission reaches admins through its catalogue entry).
    const owner = await ownerSignedIn(app);
    expect((await owner.post('/site-api/exports', {kind: 'responses', formId: form.id, query: {}})).status).toBe(202);
  });
});
