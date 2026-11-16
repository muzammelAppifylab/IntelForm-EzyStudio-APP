import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Publish checks beyond logic: settings that only work with a particular question setup.
 * Fresh migrated database per run (server/test/harness.ts).
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_p'
process.env.TEST_APP_URL ??= 'http://localhost:5189'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const { TEST_ORIGIN } = await import('../test/env')
const { setupTestDb } = await import('../test/harness')
const ctx = await setupTestDb()
const { app, sql } = ctx
const { hashToken, randomToken } = await import('../lib/crypto')

const token = randomToken()

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: {
      origin: TEST_ORIGIN,
      cookie: `intelform_session=${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json }
}

beforeAll(async () => {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (name, email, password_hash, role) VALUES ('Owner', 'owner@example.com', 'x', 'owner') RETURNING id
  `
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${hashToken(token)}, ${u.id}, now() + interval '1 day')`
})

afterAll(async () => {
  await ctx.teardown()
})

describe('one response per email', () => {
  it('blocks publish until the email question is required, then publishes', async () => {
    const { body: form } = await call('POST', '/api/forms', { title: 'Sign-up' })
    const email = { id: 'f_email001', type: 'email', label: 'Email', required: false, props: {} }
    const draft = { layout: 'all_at_once', fields: [email] }
    const settings = { onePerEmail: true, onePerEmailFieldId: 'f_email001' }
    expect((await call('PATCH', `/api/forms/${form.id}`, { draft, settings })).status).toBe(200)

    const blocked = await call('POST', `/api/forms/${form.id}/publish`)
    expect(blocked.status).toBe(422)
    expect(blocked.body.error.code).toBe('logic_issues')
    expect(blocked.body.error.issues.map((i: Json) => i.code)).toContain('one_per_email')

    const fixed = { layout: 'all_at_once', fields: [{ ...email, required: true }] }
    expect((await call('PATCH', `/api/forms/${form.id}`, { draft: fixed })).status).toBe(200)
    expect((await call('POST', `/api/forms/${form.id}/publish`)).status).toBe(200)
  })
})
