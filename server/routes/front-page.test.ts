import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for /api/front-page and the public front page routes, on a fresh migrated
 * database (server/test/harness.ts). Locally the base is intelform_h; CI sets TEST_DATABASE_URL.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_h'
process.env.TEST_APP_URL ??= 'http://localhost:5188'

type Role = 'owner' | 'editor' | 'viewer'
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

/** Creates a form with one question and a 3-minute start screen; publishes it unless told not to. */
async function newForm(title: string, publish = true) {
  const created = await call('owner', 'POST', '/api/forms', { title })
  expect(created.status).toBe(201)
  const id = created.body.id as string
  const detail = await call('owner', 'GET', `/api/forms/${id}`)
  const draft = { ...detail.body.draft, fields: [question], startScreen: { enabled: true, title, button: 'Start', minutes: 3 } }
  const patched = await call('owner', 'PATCH', `/api/forms/${id}`, { draft })
  expect(patched.status, JSON.stringify(patched.body)).toBe(200)
  if (publish) expect((await call('owner', 'POST', `/api/forms/${id}/publish`, {})).status).toBe(200)
  return { id, slug: created.body.slug as string }
}

async function settingsOf(id: string) {
  const [row] = await sql<{ settings: Json }[]>`SELECT settings FROM forms WHERE id = ${id}`
  return row.settings
}

beforeAll(async () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
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

describe('roles', () => {
  it('needs a session', async () => {
    expect((await call(null, 'GET', '/api/front-page')).status).toBe(401)
    expect((await call(null, 'PATCH', '/api/front-page', { enabled: true })).status).toBe(401)
  })

  it('lets a Viewer read but not write', async () => {
    const read = await call('viewer', 'GET', '/api/front-page')
    expect(read.status).toBe(200)
    expect(read.body.content.enabled).toBe(false)
    expect((await call('viewer', 'GET', '/api/front-page/forms')).status).toBe(200)
    expect((await call('viewer', 'PATCH', '/api/front-page', { enabled: true })).status).toBe(403)
  })

  it('lets Owner and Editor write', async () => {
    expect((await call('editor', 'PATCH', '/api/front-page', { hero: { headline: 'Hi', text: '', imageUrl: null, imageAlt: '', buttonLabel: '', buttonUrl: null } })).status).toBe(200)
    expect((await call('owner', 'PATCH', '/api/front-page', { enabled: false })).status).toBe(200)
  })
})

describe('validation', () => {
  it('rejects unsafe links and half-filled buttons', async () => {
    const hero = { headline: 'Hi', text: '', imageUrl: null, imageAlt: '', buttonLabel: 'Go', buttonUrl: 'javascript:alert(1)' }
    expect((await call('owner', 'PATCH', '/api/front-page', { hero })).status).toBe(422)
    expect((await call('owner', 'PATCH', '/api/front-page', { hero: { ...hero, buttonUrl: null } })).status).toBe(422)
    expect((await call('owner', 'PATCH', '/api/front-page', { hero: { ...hero, buttonUrl: 'https://example.com' } })).status).toBe(200)
  })

  it('rejects an unknown theme, a bad contact email and duplicate featured forms', async () => {
    expect((await call('owner', 'PATCH', '/api/front-page', { themeId: 'neon' })).status).toBe(422)
    const contact = { enabled: true, email: 'not-an-email', phone: '', address: '' }
    expect((await call('owner', 'PATCH', '/api/front-page', { contact })).status).toBe(422)
    const id = crypto.randomUUID()
    const dupes = [{ formId: id, description: '' }, { formId: id, description: '' }]
    expect((await call('owner', 'PATCH', '/api/front-page', { featured: dupes })).status).toBe(422)
  })

  it('only features Live forms', async () => {
    const draft = await newForm('Draft only', false)
    const res = await call('owner', 'PATCH', '/api/front-page', { featured: [{ formId: draft.id, description: '' }] })
    expect(res.status).toBe(422)
    expect(res.body.error.fields.featured[0]).toMatch(/Live/)
    expect((await call('owner', 'PATCH', '/api/front-page', { featured: [{ formId: crypto.randomUUID(), description: '' }] })).status).toBe(422)
  })
})

describe('featured forms', () => {
  it('syncs with forms.settings and lists only Live forms publicly', async () => {
    const a = await newForm('Alpha survey')
    const b = await newForm('Beta feedback')
    const hidden = await newForm('Not featured')

    const pick = await call('editor', 'GET', '/api/front-page/forms')
    expect(pick.body.forms.map((f: Json) => f.title)).toEqual(expect.arrayContaining(['Alpha survey', 'Beta feedback', 'Not featured']))
    expect(pick.body.forms.map((f: Json) => f.title)).not.toContain('Draft only')

    const saved = await call('owner', 'PATCH', '/api/front-page', {
      enabled: true,
      featured: [
        { formId: b.id, description: 'Tell us how we did' },
        { formId: a.id, description: 'Quick one' },
      ],
    })
    expect(saved.status).toBe(200)
    expect(saved.body.featured.map((f: Json) => f.title)).toEqual(['Beta feedback', 'Alpha survey'])
    expect(saved.body.featured[0]).toMatchObject({ minutes: 3, isPublic: true, status: 'live' })

    // Agent D's per-form keys follow the editor.
    expect(await settingsOf(b.id)).toMatchObject({ showOnFrontPage: true, frontPageDescription: 'Tell us how we did' })
    expect((await settingsOf(hidden.id)).showOnFrontPage).toBe(false)

    const home = await call(null, 'GET', '/api/public/home')
    expect(home.status).toBe(200)
    expect(home.body.enabled).toBe(true)
    expect(home.body.forms).toEqual([
      { title: 'Beta feedback', slug: b.slug, description: 'Tell us how we did', minutes: 3 },
      { title: 'Alpha survey', slug: a.slug, description: 'Quick one', minutes: 3 },
    ])

    // The Share tab turning a form on shows it here too (last, until reordered).
    expect((await call('owner', 'PATCH', `/api/forms/${hidden.id}`, { settings: { showOnFrontPage: true, frontPageDescription: 'From share' } })).status).toBe(200)
    const view = await call('viewer', 'GET', '/api/front-page')
    expect(view.body.featured.map((f: Json) => f.title)).toEqual(['Beta feedback', 'Alpha survey', 'Not featured'])
    expect(view.body.featured[2].description).toBe('From share')

    // Closing a form drops it from the public page but keeps it in the editor list.
    expect((await call('owner', 'POST', `/api/forms/${b.id}/close`, {})).status).toBe(200)
    const after = await call(null, 'GET', '/api/public/home')
    expect(after.body.forms.map((f: Json) => f.title)).toEqual(['Alpha survey', 'Not featured'])
    const editor = await call('owner', 'GET', '/api/front-page')
    expect(editor.body.featured.find((f: Json) => f.formId === b.id)).toMatchObject({ status: 'closed', isPublic: false })

    // A close date in the past hides it even before the scheduler runs.
    await sql`UPDATE forms SET settings = settings || '{"closeAt": "2020-01-01T00:00:00Z"}'::jsonb WHERE id = ${a.id}`
    expect((await call(null, 'GET', '/api/public/home')).body.forms.map((f: Json) => f.title)).toEqual(['Not featured'])

    // A closed form already featured may stay in the saved list; removing one unsets its key.
    const kept = await call('owner', 'PATCH', '/api/front-page', { featured: [{ formId: b.id, description: 'Tell us how we did' }] })
    expect(kept.status).toBe(200)
    expect((await settingsOf(a.id)).showOnFrontPage).toBe(false)
    expect((await settingsOf(hidden.id)).showOnFrontPage).toBe(false)
    expect((await call('owner', 'PATCH', '/api/front-page', { featured: [] })).status).toBe(200)
    expect((await settingsOf(b.id)).showOnFrontPage).toBe(false)
  })
})

describe('public routes', () => {
  it('reports the page off and keeps legal texts', async () => {
    await call('owner', 'PATCH', '/api/front-page', { enabled: false, privacy: 'We keep little.\n\nAsk us anything.' })
    expect((await call(null, 'GET', '/api/public/home')).body).toEqual({ enabled: false })
    const legal = await call(null, 'GET', '/api/public/legal/privacy')
    expect(legal.body).toMatchObject({ kind: 'privacy', title: 'Privacy policy', text: 'We keep little.\n\nAsk us anything.' })
    expect((await call(null, 'GET', '/api/public/legal/cookies')).status).toBe(404)
  })

  it('hides empty about and contact blocks', async () => {
    await call('owner', 'PATCH', '/api/front-page', {
      enabled: true,
      about: { enabled: true, title: '', text: '' },
      contact: { enabled: false, email: 'hi@example.com', phone: '', address: '' },
    })
    const home = await call(null, 'GET', '/api/public/home')
    expect(home.body.about).toBeNull()
    expect(home.body.contact).toBeNull()
    expect(home.body.hasPrivacy).toBe(true)
    expect(home.body.hasTerms).toBe(false)
  })

  it('returns app info with branding and a boolean emailEnabled', async () => {
    const res = await call(null, 'GET', '/api/public/app')
    expect(res.body).toMatchObject({ appName: 'IntelForm', faviconUrl: null, accentColor: null, defaultMode: 'system', emailEnabled: false })
  })
})

describe('front page HTML', () => {
  it('puts escaped SEO tags in the shell, and noindex when off or not indexable', async () => {
    const { injectHomeMeta } = await import('./front-page')
    const { readFrontPage } = await import('../../shared/api-front')
    const shell = '<html><head><meta charset="UTF-8" /><title>IntelForm</title></head><body></body></html>'
    const on = readFrontPage({
      enabled: true,
      hero: { headline: 'Tell us <what> you think', text: 'Short surveys.' },
      seo: { title: '', description: '', ogImage: '/uploads/og.png', indexing: true },
    })
    const page = injectHomeMeta(shell, on, 'Acme', 'https://forms.example.com')
    expect(page.noindex).toBe(false)
    expect(page.html).toContain('<meta charset="UTF-8" />\n<title data-ssr>Tell us &lt;what&gt; you think</title>')
    expect(page.html).toContain('<meta data-ssr property="og:description" content="Short surveys.">')
    expect(page.html).toContain('<meta data-ssr property="og:image" content="https://forms.example.com/uploads/og.png">')
    expect(page.html).not.toContain('name="robots"')

    expect(injectHomeMeta(shell, { ...on, seo: { ...on.seo, indexing: false } }, 'Acme', 'https://x.test').html).toContain('noindex')
    expect(injectHomeMeta(shell, readFrontPage({}), 'Acme', 'https://x.test')).toEqual({ html: shell, noindex: true })
  })
})
