import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {ensurePermissions} from '../../src/platform/permission-sync';
import {app} from '../../src/server/app';
// Registers the job handlers: locally an export job runs as soon as it is sent.
import '../../src/server/background';
import {CATALOGUE, PERMISSIONS} from '../../src/server/permissions';
import {encodeContactCursor} from '../../src/server/intelform/contacts/sql';
import {syncFormCounts} from '../../src/server/intelform/forms/counts';
import {type Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * The Contacts API (`/site-api/contacts`) against a real Postgres: the trigger fills the contact
 * columns, the routes group, filter, export and erase. Ported from legacy contacts.int.test.ts.
 */

const F = {name: 'f_name0001', email: 'f_email001', phone: 'f_phone001', text: 'f_text0001'};

const fields = (types: ('name' | 'email' | 'phone')[]) => [
  ...types.map(t => ({id: F[t], type: t, label: t, required: false, props: t === 'name' ? {split: true} : {}})),
  {id: F.text, type: 'short_text', label: 'Anything else?', required: false, props: {}},
];

async function form(title: string, types: ('name' | 'email' | 'phone')[]) {
  const def = JSON.stringify({layout: 'all_at_once', startScreen: {enabled: false}, endScreen: {title: 'Thanks'}, fields: fields(types)});
  const slug = title.toLowerCase().replace(/\W+/g, '-');
  const [f] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO forms (slug, title, status, draft, settings, theme) VALUES (${slug}, ${title}, 'live', ${def}::jsonb, '{}'::jsonb, '{}'::jsonb) RETURNING id::text AS id`;
  const [v] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${f!.id}::uuid, 1, ${def}::jsonb, '{}'::jsonb) RETURNING id::text AS id`;
  await db.$executeRaw`UPDATE forms SET published_version_id = ${v!.id}::uuid WHERE id = ${f!.id}::uuid`;
  return {id: f!.id, versionId: v!.id};
}

async function respond(fm: {id: string; versionId: string}, answers: Record<string, unknown>, hoursAgo: number, country = 'GB') {
  await db.$executeRaw`
    INSERT INTO responses (form_id, form_version_id, answers, submitted_at, device, country)
    VALUES (${fm.id}::uuid, ${fm.versionId}::uuid, ${JSON.stringify(answers)}::jsonb, now() - make_interval(hours => ${hoursAgo}), 'desktop', ${country})`;
  await db.$executeRaw`
    UPDATE forms SET response_count = (SELECT count(*) FROM responses WHERE form_id = ${fm.id}::uuid),
      last_response_at = (SELECT max(submitted_at) FROM responses WHERE form_id = ${fm.id}::uuid) WHERE id = ${fm.id}::uuid`;
}

/** Exactly these roles (whatever sign-up gave). */
async function setRoles(email: string, ...slugs: string[]) {
  const id = await userId(email);
  const roles = await db.role.findMany({where: {slug: {in: slugs}}, select: {id: true}});
  await db.userRole.deleteMany({where: {userId: id}});
  await db.userRole.createMany({data: roles.map(role => ({userId: id, roleId: role.id}))});
}

/** The IntelForm grants the editor / viewer roles get by default. */
async function grant(slug: string, codenames: string[]) {
  const role = await db.role.findUniqueOrThrow({where: {slug}, select: {id: true}});
  const perms = await db.permission.findMany({where: {codename: {in: codenames}}, select: {id: true}});
  await db.rolePermission.createMany({data: perms.map(p => ({roleId: role.id, permissionId: p.id})), skipDuplicates: true});
}

describe.skipIf(!DATABASE_URL)('contacts (integration, real Postgres)', () => {
  let editor: Browser;
  let viewer: Browser;
  let member: Browser;
  let clerk: Browser;
  let survey: {id: string; versionId: string};
  let signup: {id: string; versionId: string};

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    await ensurePermissions(db, CATALOGUE);
    await grant('editor', [PERMISSIONS.CONTACT_READ, PERMISSIONS.CONTACT_WRITE, PERMISSIONS.RESPONSE_DELETE]);
    await grant('viewer', [PERMISSIONS.CONTACT_READ]);
    // A custom role an admin could build: may edit contacts, may NOT delete responses.
    await db.role.create({data: {slug: 'clerk', name: 'Clerk'}});
    await grant('clerk', [PERMISSIONS.CONTACT_READ, PERMISSIONS.CONTACT_WRITE]);
    editor = await signedIn(app, 'editor@example.test', undefined, '203.0.113.51');
    viewer = await signedIn(app, 'viewer@example.test', undefined, '203.0.113.52');
    member = await signedIn(app, 'member@example.test', undefined, '203.0.113.53');
    clerk = await signedIn(app, 'clerk@example.test', undefined, '203.0.113.54');
    await setRoles('clerk@example.test', 'member', 'clerk');
    await setRoles('editor@example.test', 'member', 'editor');
    await setRoles('viewer@example.test', 'member', 'viewer');
    await setRoles('member@example.test', 'member');

    survey = await form('Customer survey', ['name', 'email']);
    signup = await form('Event signup', ['email', 'phone']);
    const callback = await form('Callback request', ['phone']);
    // Ada answers both forms (the second time with stray spaces and capitals in her email).
    await respond(survey, {[F.name]: {first: 'Ada', last: 'Lovelace'}, [F.email]: 'ada@example.com'}, 400, 'GB');
    await respond(signup, {[F.email]: '  ADA@Example.com ', [F.phone]: '+44 7700 900111'}, 2, 'FR');
    await respond(survey, {[F.name]: {first: 'Grace', last: ''}, [F.email]: 'grace@example.com'}, 30, 'US');
    // Phone only, then no contact details at all.
    await respond(callback, {[F.phone]: '+15555550123'}, 5, 'US');
    await respond(survey, {[F.text]: 'anonymous'}, 1);
  }, 120_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('needs site:contact:read', async () => {
    expect((await member.get('/site-api/contacts')).status).toBe(403);
    expect((await member.get('/site-api/contacts/detail?key=e:ada@example.com')).status).toBe(403);
    expect((await member.post('/site-api/exports', {kind: 'contacts', query: {}})).status).toBe(403);
  });

  it('groups by email across forms and keeps phone-only contacts', async () => {
    const res = await viewer.get('/site-api/contacts');
    expect(res.status).toBe(200);
    const body = res.json as {nextCursor: string | null; contacts: {key: string; name: string | null; email: string | null; forms: {title: string}[]}[]};
    expect(body.contacts).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
    expect(body.contacts.map(c => c.key)).toEqual(['e:ada@example.com', 'p:+15555550123', 'e:grace@example.com']);
    expect(body.contacts[0]).toMatchObject({name: 'Ada Lovelace', phone: '+447700900111', country: 'FR', responseCount: 2, formCount: 2});
    expect(body.contacts[0]!.forms.map(f => f.title)).toEqual(['Event signup', 'Customer survey']);
    expect(body.contacts[1]).toMatchObject({email: null, phone: '+15555550123', name: null});
    const overview = (await viewer.get('/site-api/contacts/overview')).json as {strip: unknown; facets: {forms: unknown[]; countries: unknown[]}};
    expect(overview.strip).toMatchObject({total: 3, returning: 1, newThisWeek: 2, withPhonePct: 67});
    expect(overview.facets.forms[0]).toMatchObject({title: 'Customer survey', contacts: 2, status: 'live'});
    expect(overview.facets.countries).toEqual([
      {code: 'US', contacts: 2},
      {code: 'FR', contacts: 1},
    ]);
  });

  it('filters and sorts', async () => {
    const keys = async (qs: string) => {
      const res = await editor.get(`/site-api/contacts?${qs}`);
      expect(res.status).toBe(200);
      return (res.json as {contacts: {key: string}[]}).contacts.map(c => c.key);
    };
    expect(await keys(`form=${signup.id}`)).toEqual(['e:ada@example.com']);
    expect(await keys('has=phone&has=email')).toEqual(['e:ada@example.com']);
    expect(await keys('q=LOVE')).toEqual(['e:ada@example.com']);
    expect(await keys('q=555 555')).toEqual(['p:+15555550123']);
    expect(await keys('segment=returning')).toEqual(['e:ada@example.com']);
    expect(await keys('country=US&min=1&max=1')).toEqual(['p:+15555550123', 'e:grace@example.com']);
    expect(await keys('sort=name&dir=asc')).toEqual(['e:ada@example.com', 'e:grace@example.com', 'p:+15555550123']);
    expect(await keys('sort=responses&dir=desc')).toEqual(['e:ada@example.com', 'p:+15555550123', 'e:grace@example.com']);
    // Keyset pages in a sort: the cursor after the first row brings the rest, in order.
    const first = (await editor.get('/site-api/contacts?sort=responses&dir=desc')).json as {contacts: {key: string}[]};
    expect(first.contacts).toHaveLength(3);
    for (const sort of ['name', 'last_seen', 'first_seen', 'email', 'responses'] as const) {
      const all = await keys(`sort=${sort}&dir=asc`);
      const ada = (await db.contact.findUniqueOrThrow({where: {key: all[0]!}, select: {lastSeen: true, firstSeen: true, name: true, email: true, n: true}}));
      const v = {name: ada.name?.toLowerCase() ?? null, last_seen: ada.lastSeen.toISOString(), first_seen: ada.firstSeen.toISOString(), email: ada.email, responses: String(ada.n)}[sort];
      const cursor = encodeContactCursor({v, k: all[0]!});
      expect(await keys(`sort=${sort}&dir=asc&cursor=${cursor}`), sort).toEqual(all.slice(1));
    }
    expect((await editor.get('/site-api/contacts?min=3&max=2')).status).toBe(422);
  });

  it('shows one contact, and 404s for unknown keys', async () => {
    const res = await viewer.get('/site-api/contacts/detail?key=e:ada@example.com');
    expect(res.status).toBe(200);
    const body = res.json as {responses: {form: {title: string}}[]; forms: {responses: number}[]};
    expect(body.responses).toHaveLength(2);
    expect(body.responses[0]!.form.title).toBe('Event signup');
    expect(body.forms.map(f => f.responses)).toEqual([1, 1]);
    expect((await viewer.get('/site-api/contacts/detail?key=e:nobody@example.com')).status).toBe(404);
    expect((await viewer.get('/site-api/contacts/detail?key=bogus')).status).toBe(404);
  });

  it('exports CSV (a background job, then the download)', async () => {
    const started = await viewer.post('/site-api/exports', {kind: 'contacts', query: {key: ['e:ada@example.com'], tz: 'UTC'}});
    expect(started.status).toBe(202);
    const job = started.json as {id: string; status: string; rows: number};
    expect(job).toMatchObject({status: 'ready', rows: 1});
    // Someone else's export is not theirs to see.
    expect((await editor.get(`/site-api/exports/${job.id}`)).status).toBe(404);
    const res = await viewer.get(`/site-api/exports/${job.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = String((res.json as {text?: string}).text ?? '');
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,Country,Responses,Forms,First seen,Last active');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Ada Lovelace,ada@example\.com,'\+447700900111,FR,2,Event signup; Customer survey,/);
  });

  it('erases every response of a contact; viewers cannot, nor can a role without response deletion', async () => {
    expect((await viewer.post('/site-api/contacts/delete', {keys: ['e:ada@example.com']})).status).toBe(403);
    const before = await db.response.count();
    expect((await clerk.post('/site-api/contacts/delete', {keys: ['e:ada@example.com']})).status).toBe(403);
    expect(await db.response.count()).toBe(before);
    expect((await editor.post('/site-api/contacts/delete', {keys: []})).status).toBe(422);
    const res = await editor.post('/site-api/contacts/delete', {keys: ['e:ada@example.com', 'e:nobody@example.com']});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({contacts: 1, responses: 2});
    // The delete trigger keeps form_counts exact; the copy on forms follows with the minute sync.
    const exact = await db.formCount.groupBy({by: ['formId'], where: {formId: {in: [survey.id, signup.id]}}, _sum: {responses: true}});
    expect(Object.fromEntries(exact.map(e => [e.formId, e._sum.responses]))).toEqual({[survey.id]: 2, [signup.id]: 0});
    await syncFormCounts(db);
    const counts = await db.form.findMany({where: {id: {in: [survey.id, signup.id]}}, select: {id: true, responseCount: true, lastResponseAt: true}});
    const byId = Object.fromEntries(counts.map(c => [c.id, c]));
    expect(byId[survey.id]!.responseCount).toBe(2);
    expect(byId[signup.id]!.responseCount).toBe(0);
    expect(byId[signup.id]!.lastResponseAt).toBeNull();
    expect(((await editor.get('/site-api/contacts')).json as {contacts: unknown[]}).contacts).toHaveLength(2);
    // The contacts rows follow the responses (the delete trigger).
    expect(await db.contact.count()).toBe(2);
  });
});
