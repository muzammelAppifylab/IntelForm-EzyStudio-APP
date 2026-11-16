import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for the public site's data routes and its Settings (Public site tab), on a
 * fresh migrated database (server/test/harness.ts). Locally the base is intelform_h; CI sets
 * TEST_DATABASE_URL.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_h'
process.env.TEST_APP_URL ??= 'http://localhost:5188'

type Role = 'owner' | 'editor'
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const { TEST_ORIGIN } = await import('../test/env')
const { setupTestDb } = await import('../test/harness')
const ctx = await setupTestDb()
const { app, sql } = ctx
const { hashToken, randomToken } = await import('../lib/crypto')

const tokens = {} as Record<Role, string>

async function call(as: Role | null, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: {
      origin: TEST_ORIGIN,
      ...(as ? { cookie: `intelform_session=${tokens[as]}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json }
}

const question = { id: 'f_name1', type: 'short_text', label: 'Your name', required: false, props: {} }

/** A published form with one question and a 3-minute start screen, listed on the homepage. */
async function listedForm(title: string) {
  const created = await call('owner', 'POST', '/api/forms', { title })
  expect(created.status).toBe(201)
  const id = created.body.id as string
  const detail = await call('owner', 'GET', `/api/forms/${id}`)
  const draft = { ...detail.body.draft, fields: [question], startScreen: { enabled: true, title, button: 'Start', minutes: 3 } }
  expect((await call('owner', 'PATCH', `/api/forms/${id}`, { draft, settings: { showOnFrontPage: true, frontPageDescription: `About ${title}` } })).status).toBe(200)
  expect((await call('owner', 'POST', `/api/forms/${id}/publish`, {})).status).toBe(200)
  return { id, slug: created.body.slug as string }
}

beforeAll(async () => {
  for (const role of ['owner', 'editor'] as const) {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (${role}, ${`${role}@example.com`}, 'x', ${role}) RETURNING id
    `
    tokens[role] = randomToken()
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${hashToken(tokens[role])}, ${u.id}, now() + interval '1 day')`
  }
})

afterAll(async () => {
  await ctx.teardown()
})

describe('public site', () => {
  it('lists Live forms turned on in the Share tab, by title, until they close', async () => {
    const b = await listedForm('Beta feedback')
    const a = await listedForm('Alpha survey')
    await call('owner', 'POST', '/api/forms', { title: 'Draft only' })

    const home = await call(null, 'GET', '/api/public/home')
    expect(home.status).toBe(200)
    expect(home.body).toMatchObject({ appName: 'IntelForm', indexing: false, hasPrivacy: false, hasTerms: false })
    expect(home.body.forms).toEqual([
      { title: 'Alpha survey', slug: a.slug, description: 'About Alpha survey', minutes: 3 },
      { title: 'Beta feedback', slug: b.slug, description: 'About Beta feedback', minutes: 3 },
    ])

    expect((await call('owner', 'POST', `/api/forms/${b.id}/close`, {})).status).toBe(200)
    // A close date in the past hides it even before the scheduler runs.
    await sql`UPDATE forms SET settings = settings || '{"closeAt": "2020-01-01T00:00:00Z"}'::jsonb WHERE id = ${a.id}`
    expect((await call(null, 'GET', '/api/public/home')).body.forms).toEqual([])
  })

  it('takes search and legal texts from Settings, which only the Owner can change', async () => {
    const patch = { site: { indexing: true, description: 'Short surveys.' }, legal: { privacy: 'We keep little.\n\nAsk us anything.' } }
    expect((await call('editor', 'PATCH', '/api/settings', patch)).status).toBe(403)
    const saved = await call('owner', 'PATCH', '/api/settings', patch)
    expect(saved.status).toBe(200)
    expect(saved.body.site).toEqual({ indexing: true, description: 'Short surveys.', ogImage: null, contactEmail: '' })
    expect(saved.body.legal).toEqual({ privacy: 'We keep little.\n\nAsk us anything.', terms: '' })
    expect((await call('owner', 'PATCH', '/api/settings', { site: { ogImage: 'https://elsewhere.example/x.png' } })).status).toBe(422)

    expect((await call(null, 'GET', '/api/public/home')).body).toMatchObject({ description: 'Short surveys.', indexing: true, hasPrivacy: true, hasTerms: false })
    const legal = await call(null, 'GET', '/api/public/legal/privacy')
    expect(legal.body).toMatchObject({ kind: 'privacy', title: 'Privacy policy', text: 'We keep little.\n\nAsk us anything.' })
    expect((await call(null, 'GET', '/api/public/legal/cookies')).status).toBe(404)
  })
})

describe('home page HTML', () => {
  it('puts escaped search tags in the shell, and noindex unless indexing is on', async () => {
    const { injectHomeMeta } = await import('../lib/public-site')
    const shell = '<html><head><meta charset="UTF-8" /><title>IntelForm</title></head><body></body></html>'
    const site = { indexing: true, description: 'Short surveys.', ogImage: '/uploads/og.png', contactEmail: '' }
    const page = injectHomeMeta(shell, site, 'Tell us <what>', 'https://forms.example.com')
    expect(page.noindex).toBe(false)
    expect(page.html).toContain('<meta charset="UTF-8" />\n<title data-ssr>Tell us &lt;what&gt;</title>')
    expect(page.html).toContain('<meta data-ssr property="og:description" content="Short surveys.">')
    expect(page.html).toContain('<meta data-ssr property="og:image" content="https://forms.example.com/uploads/og.png">')
    expect(page.html).not.toContain('name="robots"')

    const off = injectHomeMeta(shell, { ...site, indexing: false }, 'Acme', 'https://x.test')
    expect(off.noindex).toBe(true)
    expect(off.html).toContain('<meta data-ssr name="robots" content="noindex">')
  })
})
