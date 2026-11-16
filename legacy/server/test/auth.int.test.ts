import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OWNER, addMember, setupOwner, setupTestDb, type TestClient, type TestContext } from './harness'

let ctx: TestContext
let owner: TestClient
const sent: { to: string[]; subject: string; text: string }[] = []

beforeAll(async () => {
  ctx = await setupTestDb()
  const { setTestEmailDriver } = await import('../lib/email')
  setTestEmailDriver({
    async send(m) {
      sent.push(m)
      return {}
    },
    async verify() {},
  })
}, 60_000)
afterAll(() => ctx?.teardown())
beforeEach(() => {
  sent.length = 0
})

async function drainJobs() {
  const { drain } = await import('../lib/jobs')
  await drain()
}

describe('setup', () => {
  it('reports needsSetup on a fresh install', async () => {
    const res = await ctx.client().get('/api/setup')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ needsSetup: true, tokenRequired: false })
  })

  it('creates the Owner once, signs them in, and then refuses', async () => {
    owner = await setupOwner(ctx)
    expect(owner.me?.role).toBe('owner')
    expect((await owner.get('/api/me')).body.email).toBe(OWNER.email)

    const again = await ctx.client().post('/api/setup', { ...OWNER, email: 'other@example.com' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('already_set_up')
    expect((await ctx.client().get('/api/setup')).body).toEqual({ needsSetup: false, tokenRequired: false })
  })

  it('rate-limits setup attempts per IP', async () => {
    const c = ctx.client()
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await c.post('/api/setup', OWNER)).status)
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
  })
})

describe('sessions', () => {
  it('sets an httpOnly SameSite=Lax cookie and stores only an IP hash', async () => {
    const c = ctx.client()
    const res = await c.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })
    expect(res.status).toBe(200)
    const cookie = res.headers.getSetCookie().join('\n')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    // APP_URL is http in tests: no Secure flag and no __Host- prefix.
    expect(cookie).not.toMatch(/Secure/i)
    const rows = await ctx.sql<{ ip_hash: string | null }[]>`SELECT ip_hash FROM sessions`
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.ip_hash).not.toContain('203.0.')
      expect(r.ip_hash).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('logging in again ends the old session (A9)', async () => {
    const c = ctx.client()
    await c.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })
    const oldCookie = [...c.cookies.values()][0]
    await c.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })
    const stale = ctx.client()
    stale.cookies.set([...c.cookies.keys()][0], oldCookie)
    expect((await stale.get('/api/me')).status).toBe(401)
    expect((await c.get('/api/me')).status).toBe(200)
  })

  it('logout ends the session', async () => {
    const c = ctx.client()
    await c.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })
    const token = [...c.cookies.entries()][0]
    expect((await c.post('/api/auth/logout')).status).toBe(204)
    expect(c.cookies.size).toBe(0)
    const replay = ctx.client()
    replay.cookies.set(token[0], token[1])
    expect((await replay.get('/api/me')).status).toBe(401)
  })

  it('rejects wrong passwords with the same message as unknown emails', async () => {
    const c = ctx.client()
    const wrong = await c.post('/api/auth/login', { email: OWNER.email, password: 'nope-nope-nope' })
    const unknown = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'nope-nope-nope' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body.error.message).toBe(unknown.body.error.message)
  })
})

describe('login rate limits', () => {
  const login = (c: TestClient, email: string, password: string) => c.post('/api/auth/login', { email, password })

  it('backs off a caller after 5 failures on an account, for unknown emails too (A2)', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Backoff')
    for (const target of [member.me!.email, 'nobody-here@example.com']) {
      const attacker = ctx.client()
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) statuses.push((await login(attacker, target, 'wrong-password')).status)
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
      // The same caller stays locked even with the right password.
      const locked = await login(attacker, target, 'member-password-1')
      expect(locked.status).toBe(429)
      expect(locked.headers.get('retry-after')).toMatch(/^\d+$/)
    }
  })

  it('a caller failing many times does not lock the account for anyone else', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Victim')
    const attacker = ctx.client()
    for (let i = 0; i < 8; i++) await login(attacker, member.me!.email, 'wrong-password')
    expect((await login(attacker, member.me!.email, 'member-password-1')).status).toBe(429)
    expect((await login(ctx.client(), member.me!.email, 'member-password-1')).status).toBe(200)
    // The real user's sign-in doesn't hand the attacker fresh tries.
    expect((await login(attacker, member.me!.email, 'wrong-password')).status).toBe(429)
  })

  it('locks an account for everyone after 50 failures in 15 minutes across IPs', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Ceiling')
    const { hashToken } = await import('../lib/crypto')
    // Stand in for 48 failures from other IPs earlier in this window.
    await ctx.sql`
      INSERT INTO rate_limits (key, window_start, window_seconds, count)
      VALUES (${`login:email-fail:${hashToken(member.me!.email)}`}, date_bin(make_interval(secs => 900), now(), 'epoch'), 900, 48)
    `
    expect((await login(ctx.client(), member.me!.email, 'wrong-password')).status).toBe(401)
    expect((await login(ctx.client(), member.me!.email, 'member-password-1')).status).toBe(200)
    expect((await login(ctx.client(), member.me!.email, 'wrong-password')).status).toBe(401)
    const locked = await login(ctx.client(), member.me!.email, 'member-password-1')
    expect(locked.status).toBe(429)
    expect(Number(locked.headers.get('retry-after'))).toBeLessThanOrEqual(900)
  })

  it('limits one IP to 30 login attempts per 15 minutes', async () => {
    const c = ctx.client()
    let last = 0
    for (let i = 0; i < 31; i++) last = (await c.post('/api/auth/login', { email: `spray${i}@example.com`, password: 'x' })).status
    expect(last).toBe(429)
    // Another IP is unaffected.
    expect((await ctx.client().post('/api/auth/login', { email: OWNER.email, password: OWNER.password })).status).toBe(200)
  })

  it('ignores a spoofed X-Forwarded-For when no proxy is trusted (A1)', async () => {
    const c = ctx.client()
    let last = 0
    for (let i = 0; i < 31; i++) {
      last = (await c.post('/api/auth/login', { email: `xff${i}@example.com`, password: 'x' }, { headers: { 'x-forwarded-for': `9.9.9.${i}` } })).status
    }
    expect(last).toBe(429)
  })
})

describe('CSRF', () => {
  it('rejects a cross-site form post with 403 and no-store', async () => {
    const res = await ctx.client().post('/api/auth/login', undefined, {
      origin: 'https://evil.example',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      raw: 'email=a%40b.c&password=x',
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('accepts the same post from our own origin', async () => {
    const res = await ctx.client().post('/api/auth/logout', undefined, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      raw: '',
    })
    expect(res.status).toBe(204)
  })
})

describe('forgot and reset', () => {
  async function requestReset(email: string) {
    const res = await ctx.client().post('/api/auth/forgot', { email })
    expect(res.status).toBe(200)
    await drainJobs()
    const mail = sent.filter((m) => m.to.includes(email) && m.subject.startsWith('Reset')).at(-1)
    return mail?.text.match(/\/reset\/([\w-]+)/)?.[1]
  }

  it('answers 200 for unknown emails and sends nothing', async () => {
    const res = await ctx.client().post('/api/auth/forgot', { email: 'ghost@example.com' })
    expect(res.status).toBe(200)
    await drainJobs()
    expect(sent.filter((m) => m.subject.startsWith('Reset'))).toHaveLength(0)
  })

  it('queues the email through jobs and the link works exactly once', async () => {
    const member = await addMember(ctx, owner, 'editor', 'Resetter')
    const token = await requestReset(member.me!.email)
    expect(token).toBeTruthy()
    const [job] = await ctx.sql`SELECT kind, done_at FROM jobs WHERE kind = 'email' ORDER BY id DESC LIMIT 1`
    expect(job.done_at).not.toBeNull()

    const c = ctx.client()
    const ok = await c.post('/api/auth/reset', { token, password: 'brand-new-pass-1' })
    expect(ok.status).toBe(200)
    expect((await c.get('/api/me')).status).toBe(200)
    // The member's old session was signed out.
    expect((await member.get('/api/me')).status).toBe(401)

    const again = await ctx.client().post('/api/auth/reset', { token, password: 'another-pass-1' })
    expect(again.status).toBe(410)
  })

  it('a new request voids the previous link (A7)', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Twice')
    const first = await requestReset(member.me!.email)
    sent.length = 0
    const second = await requestReset(member.me!.email)
    expect(first).not.toBe(second)
    expect((await ctx.client().post('/api/auth/reset', { token: first, password: 'brand-new-pass-1' })).status).toBe(410)
    expect((await ctx.client().post('/api/auth/reset', { token: second, password: 'brand-new-pass-1' })).status).toBe(200)
  })

  it('a password change voids open links (A7)', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Changer')
    const token = await requestReset(member.me!.email)
    const changed = await member.patch('/api/me', { currentPassword: 'member-password-1', newPassword: 'changed-pass-123' })
    expect(changed.status).toBe(200)
    expect((await ctx.client().post('/api/auth/reset', { token, password: 'brand-new-pass-1' })).status).toBe(410)
  })

  it('rejects a bad token without hashing and is rate-limited', async () => {
    const c = ctx.client()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await c.post('/api/auth/reset', { token: `bad-${i}`, password: 'whatever-123' })).status)
    expect(statuses.slice(0, 10).every((s) => s === 410)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('one IP asking for resets does not block the real user, but the account has a ceiling', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Flooded')
    const email = member.me!.email
    const attacker = ctx.client()
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await attacker.post('/api/auth/forgot', { email })).status)
    expect(statuses).toEqual([200, 200, 200, 429])
    expect(await requestReset(email)).toBeTruthy()

    // 3 + 1 so far; two more IPs at 3 each reach the ceiling of 10 per hour.
    for (let i = 0; i < 2; i++) {
      const c = ctx.client()
      for (let j = 0; j < 3; j++) expect((await c.post('/api/auth/forgot', { email })).status).toBe(200)
    }
    expect((await ctx.client().post('/api/auth/forgot', { email })).status).toBe(429)
    // Same answer for an unknown email, so the limit reveals nothing.
    const ghost = 'flood-ghost@example.com'
    for (let i = 0; i < 4; i++) {
      const c = ctx.client()
      for (let j = 0; j < 3; j++) await c.post('/api/auth/forgot', { email: ghost })
    }
    expect((await ctx.client().post('/api/auth/forgot', { email: ghost })).status).toBe(429)
  })

  it('returns 503 when email is off', async () => {
    const { setTestEmailDriver } = await import('../lib/email')
    setTestEmailDriver(null)
    try {
      const res = await ctx.client().post('/api/auth/forgot', { email: OWNER.email })
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('email_not_configured')
    } finally {
      setTestEmailDriver({ async send(m) { sent.push(m); return {} }, async verify() {} })
    }
  })
})

async function resetToken(email: string) {
  await ctx.client().post('/api/auth/forgot', { email })
  await drainJobs()
  return sent.filter((m) => m.to.includes(email) && m.subject.startsWith('Reset')).at(-1)?.text.match(/\/reset\/([\w-]+)/)?.[1]
}

describe('credential changes revoke access', () => {
  it('an email change voids open reset links and ends other sessions, keeping this one', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Mover')
    const other = ctx.client()
    expect((await other.post('/api/auth/login', { email: member.me!.email, password: 'member-password-1' })).status).toBe(200)
    const token = await resetToken(member.me!.email)
    expect(token).toBeTruthy()

    const moved = await member.patch('/api/me', { email: `moved.${member.me!.email}`, currentPassword: 'member-password-1' })
    expect(moved.status, moved.text).toBe(200)
    expect((await member.get('/api/me')).status).toBe(200)
    expect((await other.get('/api/me')).status).toBe(401)
    expect((await ctx.client().post('/api/auth/reset', { token, password: 'brand-new-pass-1' })).status).toBe(410)
  })

  it('a removed member invited back can’t use a reset link from before', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Returner')
    const email = member.me!.email
    const token = await resetToken(email)
    expect(token).toBeTruthy()
    expect((await owner.del(`/api/team/${member.me!.id}`)).status).toBe(204)
    const inv = await owner.post('/api/invites', { email, role: 'viewer' })
    const accepted = await ctx.client().post(`/api/invites/${inv.body.link.split('/invite/')[1]}/accept`, { name: 'Returner', password: 'returning-pass-1' })
    expect(accepted.status, accepted.text).toBe(201)
    expect((await ctx.client().post('/api/auth/reset', { token, password: 'brand-new-pass-1' })).status).toBe(410)
  })
})

describe('session lifetime', () => {
  it('refuses and deletes a session older than 90 days, however active', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Old timer')
    await ctx.sql`UPDATE sessions SET created_at = now() - interval '91 days', expires_at = now() + interval '29 days' WHERE user_id = ${member.me!.id}`
    expect((await member.get('/api/me')).status).toBe(401)
    expect(await ctx.sql`SELECT 1 FROM sessions WHERE user_id = ${member.me!.id}`).toHaveLength(0)
  })

  it('sliding expiry never runs past the absolute lifetime', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Slider')
    await ctx.sql`UPDATE sessions SET created_at = now() - interval '80 days', expires_at = now() + interval '1 day' WHERE user_id = ${member.me!.id}`
    expect((await member.get('/api/me')).status).toBe(200)
    const [row] = await ctx.sql<{ days: string }[]>`SELECT extract(epoch FROM expires_at - created_at) / 86400 AS days FROM sessions WHERE user_id = ${member.me!.id}`
    expect(Number(row.days)).toBeCloseTo(90, 1)
  })
})

describe('password rules', () => {
  it('refuse common passwords and the account’s email on change, reset and invite accept', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Picky')
    const email = member.me!.email
    for (const newPassword of ['Password123', 'qwerty123', email, email.split('@')[0].toUpperCase()]) {
      const res = await member.patch('/api/me', { currentPassword: 'member-password-1', newPassword })
      expect(res.status, newPassword).toBe(422)
      expect(res.body.error.fields.newPassword).toBeTruthy()
    }

    const token = await resetToken(email)
    const reset = await ctx.client().post('/api/auth/reset', { token, password: email.split('@')[0] })
    expect(reset.status).toBe(422)
    expect(reset.body.error.fields.password).toBeTruthy()

    const inv = await owner.post('/api/invites', { email: 'samelocal@example.com', role: 'viewer' })
    const accept = await ctx.client().post(`/api/invites/${inv.body.link.split('/invite/')[1]}/accept`, { name: 'Same', password: 'samelocal' })
    expect(accept.status).toBe(422)
    expect(accept.body.error.fields.password).toBeTruthy()
  })
})
