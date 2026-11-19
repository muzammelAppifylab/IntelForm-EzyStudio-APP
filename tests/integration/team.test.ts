import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {
  Browser,
  configureEnv,
  DATABASE_URL,
  db,
  emails,
  mailGateOpen,
  ownerSignedIn,
  resetDatabase,
  signedIn,
  signUpCodeFrom,
  tokenFrom,
  userId,
} from './support/harness';

/** Adding people by hand (`src/server/routes/team.ts`): invites, a set password, roles, anti-escalation. */
describe.skipIf(!DATABASE_URL)('team: add and invite users (integration, real Postgres)', () => {
  let owner: Browser;
  let admin: Browser;
  let member: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await ownerSignedIn(app, undefined, '203.0.113.1');
    admin = await signedIn(app, 'admin@example.test', undefined, '203.0.113.2');
    member = await signedIn(app, 'member@example.test', undefined, '203.0.113.3');
    const made = await owner.request('PUT', `/site-api/admin/users/${await userId('admin@example.test')}/roles`, {
      roles: ['member', 'admin'],
    });
    expect(made.status).toBe(200);
    // A custom role, to give to new people.
    const role = await owner.post('/site-api/admin/roles', {slug: 'reviewer', name: 'Reviewer', permissions: ['site:form:read']});
    expect(role.status).toBe(201);
  });

  it('an invite creates the account with its roles and emails a link to choose a password', async () => {
    const res = await admin.post('/site-api/team/users', {
      name: 'Sam Rivera',
      email: 'Sam@Example.test',
      roles: ['reviewer'],
      invite: true,
      password: null,
    });
    expect(res.status).toBe(201);
    expect(res.json.invited).toBe(true);
    const sam = await db.user.findUniqueOrThrow({
      where: {email: 'sam@example.test'},
      select: {id: true, name: true, passwordHash: true, emailVerifiedAt: true, roles: {select: {role: {select: {slug: true}}}}},
    });
    expect(sam.name).toBe('Sam Rivera');
    expect(sam.passwordHash).toBe('!');
    expect(sam.emailVerifiedAt).toBeNull();
    expect(sam.roles.map(r => r.role.slug)).toEqual(['reviewer']);

    // The invitee opens the link and chooses a password: confirmed, roles kept, can sign in.
    const invitee = new Browser(app, '203.0.113.50');
    const set = await invitee.post('/site-api/auth/reset-password', {
      token: tokenFrom('password_reset', 'sam@example.test'),
      password: 'a brand new passphrase',
    });
    expect(set.status).toBe(200);
    const after = await db.user.findUniqueOrThrow({
      where: {id: sam.id},
      select: {emailVerifiedAt: true, roles: {select: {role: {select: {slug: true}}}}},
    });
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(after.roles.map(r => r.role.slug)).toEqual(['reviewer']);
    const login = await invitee.post('/site-api/auth/login', {email: 'sam@example.test', password: 'a brand new passphrase'});
    expect(login.status).toBe(200);

    const event = await db.auditEvent.findFirstOrThrow({where: {action: 'user_added'}, select: {meta: true}});
    expect(JSON.stringify(event.meta)).not.toContain('passphrase');
  });

  it('a password set by an admin works after the person confirms their inbox', async () => {
    const res = await admin.post('/site-api/team/users', {
      name: 'Kim',
      email: 'kim@example.test',
      roles: ['member'],
      invite: false,
      password: 'kims first passphrase',
    });
    expect(res.status).toBe(201);
    expect(res.json.invited).toBe(false);
    expect(emails.some(e => e.to === 'kim@example.test' && e.kind === 'password_reset')).toBe(false);
    expect(JSON.stringify(res.json)).not.toContain('passphrase');

    // First sign-in: right password, but the inbox is proven with a code first.
    const kim = new Browser(app, '203.0.113.60');
    const first = await kim.post('/site-api/auth/login', {email: 'kim@example.test', password: 'kims first passphrase'});
    expect(first.status).toBe(403);
    expect(first.json.error).toBe('email_unverified');
    const verify = await kim.post('/site-api/auth/register/verify', {email: 'kim@example.test', code: signUpCodeFrom('kim@example.test')});
    expect(verify.status).toBe(201);
    await mailGateOpen();
    const again = await new Browser(app, '203.0.113.61').post('/site-api/auth/login', {
      email: 'kim@example.test',
      password: 'kims first passphrase',
    });
    expect(again.status).toBe(200);
  });

  it('checks every field and refuses a taken email', async () => {
    const bad = await admin.post('/site-api/team/users', {name: '', email: 'nope', roles: ['NOT A SLUG'], invite: false, password: null});
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.json.fields as object).sort()).toEqual(['email', 'name', 'password', 'roles']);
    const two = await admin.post('/site-api/team/users', {name: 'T', email: 't@example.test', roles: ['member', 'reviewer'], invite: true, password: null});
    expect((two.json.fields as {roles: string}).roles).toMatch(/one role/);
    const none = await admin.post('/site-api/team/users', {name: 'T', email: 't@example.test', roles: [], invite: true, password: null});
    expect(none.status).toBe(422);
    const weak = await admin.post('/site-api/team/users', {name: 'W', email: 'w@example.test', roles: ['member'], invite: false, password: 'short'});
    expect((weak.json.fields as {password: string}).password).toMatch(/at least/);
    const taken = await admin.post('/site-api/team/users', {name: 'M', email: 'MEMBER@example.test', roles: ['member'], invite: true, password: null});
    expect(taken.status).toBe(422);
    expect((taken.json.fields as {email: string}).email).toMatch(/already has an account/);
    const missing = await admin.post('/site-api/team/users', {name: 'X', email: 'x@example.test', roles: ['ghost'], invite: true, password: null});
    expect(missing.status).toBe(422);
    expect(await db.user.count({where: {email: {in: ['w@example.test', 'x@example.test']}}})).toBe(0);
  });

  it('nobody gives owner, and an admin only gives roles within their own access', async () => {
    const asOwner = await admin.post('/site-api/team/users', {name: 'O', email: 'o@example.test', roles: ['owner'], invite: true, password: null});
    expect(asOwner.status).toBe(403);
    // A role holding everything, which admins do not.
    expect((await owner.post('/site-api/admin/roles', {slug: 'role-boss', name: 'Role boss', permissions: ['*']})).status).toBe(201);
    const above = await admin.post('/site-api/team/users', {name: 'B', email: 'b@example.test', roles: ['role-boss'], invite: true, password: null});
    expect(above.status).toBe(403);
    // The owner can.
    const byOwner = await owner.post('/site-api/team/users', {name: 'B', email: 'b@example.test', roles: ['role-boss'], invite: true, password: null});
    expect(byOwner.status).toBe(201);
    expect(await db.user.count({where: {email: 'o@example.test'}})).toBe(0);
  });

  it('admins create and edit custom roles within their own access, never above it', async () => {
    const made = await admin.post('/site-api/admin/roles', {slug: 'support', name: 'Support', permissions: ['site:response:read']});
    expect(made.status).toBe(201);
    const edited = await admin.request('PATCH', '/site-api/admin/roles/support', {permissions: ['site:response:read', 'site:contact:read']});
    expect(edited.status).toBe(200);
    expect((await admin.post('/site-api/admin/roles', {slug: 'sneaky', name: 'Sneaky', permissions: ['*']})).status).toBe(403);
    expect((await admin.request('PATCH', '/site-api/admin/roles/owner', {name: 'Mine'})).status).toBe(403);
    expect((await member.post('/site-api/admin/roles', {slug: 'nope', name: 'Nope', permissions: []})).status).toBe(403);
    expect((await admin.delete('/site-api/admin/roles/support')).status).toBe(200);
  });

  it('members and guests cannot add or invite anyone', async () => {
    const body = {name: 'Z', email: 'z@example.test', roles: ['member'], invite: true, password: null};
    expect((await member.post('/site-api/team/users', body)).status).toBe(403);
    expect((await new Browser(app).post('/site-api/team/users', body)).status).toBe(401);
    const added = await admin.post('/site-api/team/users', body);
    const id = (added.json.user as {id: number}).id;
    expect((await member.post(`/site-api/team/users/${id}/invite`)).status).toBe(403);
    expect(await db.user.count({where: {email: 'z@example.test'}})).toBe(1);
  });

  it('resends an invite once per 15 minutes, only to someone who has not joined', async () => {
    const added = await admin.post('/site-api/team/users', {name: 'R', email: 'r@example.test', roles: ['member'], invite: true, password: null});
    const id = (added.json.user as {id: number}).id;
    expect((await admin.post(`/site-api/team/users/${id}/invite`)).status).toBe(429);
    await mailGateOpen();
    const sent = emails.filter(e => e.to === 'r@example.test' && e.kind === 'password_reset').length;
    expect((await admin.post(`/site-api/team/users/${id}/invite`)).status).toBe(200);
    expect(emails.filter(e => e.to === 'r@example.test' && e.kind === 'password_reset').length).toBe(sent + 1);
    // Already joined: no invite.
    expect((await admin.post(`/site-api/team/users/${await userId('member@example.test')}/invite`)).status).toBe(409);
    // Unknown and the owner's own account: 404.
    expect((await admin.post('/site-api/team/users/999999/invite')).status).toBe(404);
    expect(await db.auditEvent.count({where: {action: 'user_invite_sent'}})).toBe(1);
  });
});
