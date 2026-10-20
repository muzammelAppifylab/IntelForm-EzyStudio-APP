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
    expect(res.body).toEqual({ needsSetup: true })
  })

  it('creates the Owner once, signs them in, and then refuses', async () => {
    owner = await setupOwner(ctx)
    expect(owner.me?.role).toBe('owner')
    expect((await owner.get('/api/me')).body.email).toBe(OWNER.email)

    const again = await ctx.client().post('/api/setup', { ...OWNER, email: 'other@example.com' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('already_set_up')
    expect((await ctx.client().get('/api/setup')).body).toEqual({ needsSetup: false })
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
  it('backs off an account after 5 failures, from any IP, and for unknown emails too (A2)', async () => {
    const member = await addMember(ctx, owner, 'viewer', 'Backoff')
    for (const target of [member.me!.email, 'nobody-here@example.com']) {
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) statuses.push((await ctx.client().post('/api/auth/login', { email: target, password: 'wrong-password' })).status)
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
      const locked = await ctx.client().post('/api/auth/login', { email: target, password: 'member-password-1' })
      expect(locked.status).toBe(429)
      expect(locked.headers.get('retry-after')).toMatch(/^\d+$/)
    }
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
