import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OWNER, setupTestDb, type TestContext } from './harness'

const TOKEN = 'setup-token-for-tests-0123456789'
let ctx: TestContext

beforeAll(async () => {
  ctx = await setupTestDb({ SETUP_TOKEN: TOKEN })
  // env.ts has read it; don't leak it to other test files sharing this process.
  delete process.env.SETUP_TOKEN
}, 60_000)
afterAll(() => ctx?.teardown())

describe('setup token', () => {
  it('is reported as required while setup is open', async () => {
    expect((await ctx.client().get('/api/setup')).body).toEqual({ needsSetup: true, tokenRequired: true })
  })

  it('refuses a missing or wrong token, and a password equal to the email', async () => {
    const missing = await ctx.client().post('/api/setup', OWNER)
    expect(missing.status).toBe(422)
    expect(missing.body.error.fields.setupToken).toBeTruthy()
    const wrong = await ctx.client().post('/api/setup', { ...OWNER, setupToken: `${TOKEN}x` })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error.fields.setupToken).toBeTruthy()
    const sameAsEmail = await ctx.client().post('/api/setup', { ...OWNER, password: OWNER.email, setupToken: TOKEN })
    expect(sameAsEmail.status).toBe(422)
    expect(sameAsEmail.body.error.fields.password).toBeTruthy()
    expect(await ctx.sql`SELECT 1 FROM users`).toHaveLength(0)
  })

  it('creates the Owner with the right token', async () => {
    const ok = await ctx.client().post('/api/setup', { ...OWNER, setupToken: TOKEN })
    expect(ok.status, ok.text).toBe(201)
    expect((await ctx.client().get('/api/setup')).body).toEqual({ needsSetup: false, tokenRequired: false })
  })
})
