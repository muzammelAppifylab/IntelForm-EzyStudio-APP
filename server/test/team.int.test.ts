import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OWNER, addMember, setupOwner, setupTestDb, type TestClient, type TestContext } from './harness'

let ctx: TestContext
let owner: TestClient
let editor: TestClient
let viewer: TestClient
let anon: TestClient

// A 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

beforeAll(async () => {
  ctx = await setupTestDb()
  owner = await setupOwner(ctx)
  editor = await addMember(ctx, owner, 'editor', 'Eddie Editor')
  viewer = await addMember(ctx, owner, 'viewer', 'Vera Viewer')
  anon = ctx.client()
}, 60_000)
afterAll(() => ctx?.teardown())

type Who = 'owner' | 'editor' | 'viewer' | 'anon'
const ZERO = '00000000-0000-4000-8000-000000000000'

function uploadBody() {
  const fd = new FormData()
  fd.append('file', new File([PNG], 'dot.png', { type: 'image/png' }))
  return fd
}

/** [label, method, path, body, expected status per role] — "ok" = anything but 401/403. */
const MATRIX: [string, string, string, unknown, Record<Who, number | 'ok'>][] = [
  ['team list', 'GET', '/api/team', undefined, { owner: 200, editor: 200, viewer: 200, anon: 401 }],
  ['team patch', 'PATCH', `/api/team/${ZERO}`, { role: 'viewer' }, { owner: 404, editor: 403, viewer: 403, anon: 401 }],
  ['team delete', 'DELETE', `/api/team/${ZERO}`, undefined, { owner: 404, editor: 403, viewer: 403, anon: 401 }],
  ['transfer', 'POST', '/api/team/transfer-ownership', { userId: ZERO, currentPassword: 'x' }, { owner: 422, editor: 403, viewer: 403, anon: 401 }],
  ['invite create', 'POST', '/api/invites', { email: 'new.person@example.com', role: 'viewer' }, { owner: 201, editor: 403, viewer: 403, anon: 401 }],
  ['invite revoke', 'DELETE', `/api/invites/${ZERO}`, undefined, { owner: 404, editor: 403, viewer: 403, anon: 401 }],
  ['settings read', 'GET', '/api/settings', undefined, { owner: 200, editor: 403, viewer: 403, anon: 401 }],
  ['settings patch', 'PATCH', '/api/settings', { data: { retentionDays: null } }, { owner: 200, editor: 403, viewer: 403, anon: 401 }],
  ['settings spam test', 'POST', '/api/settings/spam/test', {}, { owner: 200, editor: 403, viewer: 403, anon: 401 }],
  ['settings email test', 'POST', '/api/settings/email/test', {}, { owner: 200, editor: 403, viewer: 403, anon: 401 }],
  ['settings storage test', 'POST', '/api/settings/storage/test', {}, { owner: 200, editor: 403, viewer: 403, anon: 401 }],
  ['settings export', 'GET', '/api/settings/data/export.zip', undefined, { owner: 200, editor: 403, viewer: 403, anon: 401 }],
  ['upload', 'POST', '/api/uploads?purpose=image', 'FORM', { owner: 201, editor: 201, viewer: 403, anon: 401 }],
]

describe('role × route matrix', () => {
  for (const [label, method, path, body, expected] of MATRIX) {
    for (const who of ['owner', 'editor', 'viewer', 'anon'] as Who[]) {
      it(`${label}: ${who} → ${expected[who]}`, async () => {
        const c = { owner, editor, viewer, anon }[who]
        const res = body === 'FORM' ? await c.request(method, path, undefined, { raw: uploadBody() }) : await c.request(method, path, body)
        if (expected[who] === 'ok') expect([401, 403]).not.toContain(res.status)
        else expect(res.status, res.text).toBe(expected[who])
      })
    }
  }
})

describe('invites', () => {
  it('an invite link works once', async () => {
    const inv = await owner.post('/api/invites', { email: 'once@example.com', role: 'viewer' })
    const token = inv.body.link.split('/invite/')[1]
    expect((await anon.get(`/api/invites/${token}`)).body).toMatchObject({ email: 'once@example.com', role: 'viewer', appName: OWNER.appName })
    const first = await ctx.client().post(`/api/invites/${token}/accept`, { name: 'Once', password: 'once-password-1' })
    expect(first.status).toBe(201)
    const second = await ctx.client().post(`/api/invites/${token}/accept`, { name: 'Twice', password: 'twice-password-1' })
    expect(second.status).toBe(410)
    expect((await anon.get(`/api/invites/${token}`)).status).toBe(410)
  })

  it('concurrent accepts of one link: exactly one wins', async () => {
    const inv = await owner.post('/api/invites', { email: 'race@example.com', role: 'editor' })
    const token = inv.body.link.split('/invite/')[1]
    const results = await Promise.all([0, 1, 2].map((i) => ctx.client().post(`/api/invites/${token}/accept`, { name: `Racer ${i}`, password: 'race-password-1' })))
    expect(results.map((r) => r.status).sort()).toEqual([201, 410, 410])
  })

  it('a re-invite replaces the old link', async () => {
    const a = await owner.post('/api/invites', { email: 'again@example.com', role: 'viewer' })
    const b = await owner.post('/api/invites', { email: 'again@example.com', role: 'editor' })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect((await anon.get(`/api/invites/${a.body.link.split('/invite/')[1]}`)).status).toBe(410)
  })

  it('racing invites to one email never 500 (unique index → 409, A11)', async () => {
    const results = await Promise.all([0, 1, 2, 3].map(() => owner.post('/api/invites', { email: 'dupe@example.com', role: 'viewer' })))
    for (const r of results) expect([201, 409]).toContain(r.status)
    expect(results.some((r) => r.status === 201)).toBe(true)
  })

  it('unknown or malformed links are 410', async () => {
    expect((await anon.get('/api/invites/not-a-real-token')).status).toBe(410)
    expect((await anon.post('/api/invites/not-a-real-token/accept', { name: 'X', password: 'xxxxxxxx1' })).status).toBe(410)
  })
})

describe('membership changes', () => {
  it('a removed member gets 401 on their next request', async () => {
    const temp = await addMember(ctx, owner, 'editor', 'Temp')
    expect((await temp.get('/api/me')).status).toBe(200)
    expect((await owner.del(`/api/team/${temp.me!.id}`)).status).toBe(204)
    expect((await temp.get('/api/me')).status).toBe(401)
    expect((await temp.get('/api/team')).status).toBe(401)
  })

  it('a role change applies on the next request', async () => {
    const m = await addMember(ctx, owner, 'editor', 'Demoted')
    expect((await m.request('POST', '/api/uploads?purpose=image', undefined, { raw: uploadBody() })).status).toBe(201)
    expect((await owner.patch(`/api/team/${m.me!.id}`, { role: 'viewer' })).status).toBe(200)
    expect((await m.request('POST', '/api/uploads?purpose=image', undefined, { raw: uploadBody() })).status).toBe(403)
  })

  it('setting a member’s password needs the Owner’s own password and signs the member out', async () => {
    const m = await addMember(ctx, owner, 'editor', 'Locked out')
    const missing = await owner.patch(`/api/team/${m.me!.id}`, { password: 'owner-chosen-pass-1' })
    expect(missing.status).toBe(422)
    expect(missing.body.error.fields.currentPassword).toBeTruthy()
    const wrong = await owner.patch(`/api/team/${m.me!.id}`, { password: 'owner-chosen-pass-1', currentPassword: 'wrong-guess' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error.fields.currentPassword).toBeTruthy()
    const asEmail = await owner.patch(`/api/team/${m.me!.id}`, { password: m.me!.email, currentPassword: OWNER.password })
    expect(asEmail.status).toBe(422)
    expect(asEmail.body.error.fields.password).toBeTruthy()
    expect((await m.get('/api/me')).status).toBe(200)

    const ok = await owner.patch(`/api/team/${m.me!.id}`, { password: 'owner-chosen-pass-1', currentPassword: OWNER.password })
    expect(ok.status, ok.text).toBe(200)
    expect((await m.get('/api/me')).status).toBe(401)
    expect((await ctx.client().post('/api/auth/login', { email: m.me!.email, password: 'owner-chosen-pass-1' })).status).toBe(200)
  })

  it('the Owner can’t be removed or changed through the member routes', async () => {
    expect((await owner.del(`/api/team/${owner.me!.id}`)).status).toBe(400)
    expect((await owner.patch(`/api/team/${owner.me!.id}`, { role: 'viewer' })).status).toBe(400)
  })
})

describe('transfer ownership', () => {
  it('concurrent transfers: exactly one succeeds and there is always one Owner (A11)', async () => {
    const a = await addMember(ctx, owner, 'editor', 'Heir A')
    const b = await addMember(ctx, owner, 'editor', 'Heir B')
    const results = await Promise.all([
      owner.post('/api/team/transfer-ownership', { userId: a.me!.id, currentPassword: OWNER.password }),
      owner.post('/api/team/transfer-ownership', { userId: b.me!.id, currentPassword: OWNER.password }),
    ])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses[0]).toBe(200)
    expect([403, 409]).toContain(statuses[1])

    const owners = await ctx.sql`SELECT id FROM users WHERE role = 'owner' AND status = 'active'`
    expect(owners).toHaveLength(1)
    expect([a.me!.id, b.me!.id]).toContain(owners[0].id)
    expect((await owner.get('/api/me')).body.role).toBe('editor')

    // Hand it back so later tests still have the original Owner.
    const heir = owners[0].id === a.me!.id ? a : b
    const back = await heir.post('/api/team/transfer-ownership', { userId: owner.me!.id, currentPassword: 'member-password-1' })
    expect(back.status).toBe(200)
  })

  it('needs the current password', async () => {
    const a = await addMember(ctx, owner, 'editor', 'Heir C')
    const res = await owner.post('/api/team/transfer-ownership', { userId: a.me!.id, currentPassword: 'wrong' })
    expect(res.status).toBe(422)
    expect(res.body.error.fields.currentPassword).toBeTruthy()
  })
})
