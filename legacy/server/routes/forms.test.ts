import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for /api/forms and /api/templates on a fresh, migrated database per run
 * (server/test/harness.ts). Locally the base is intelform_d; CI sets TEST_DATABASE_URL.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_d'
process.env.TEST_APP_URL ??= 'http://localhost:5184'

type Role = 'owner' | 'editor' | 'viewer'
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const { TEST_ORIGIN } = await import('../test/env')
const { setupTestDb } = await import('../test/harness')
const ctx = await setupTestDb()
const { app, sql } = ctx
const { hashToken, randomToken } = await import('../lib/crypto')

const tokens = {} as Record<Role, string>
const userIds = {} as Record<Role, string>

async function call(as: Role | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      origin: TEST_ORIGIN,
      ...(as ? { cookie: `intelform_session=${tokens[as]}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json }
}

/** Inserts a response the way the submit route does, counter included. */
async function addResponse(formId: string) {
  const [{ published_version_id }] = await sql`SELECT published_version_id FROM forms WHERE id = ${formId}`
  await sql`INSERT INTO responses (form_id, form_version_id, answers) VALUES (${formId}, ${published_version_id}, '{}'::jsonb)`
  await sql`UPDATE forms SET response_count = response_count + 1, last_response_at = now() WHERE id = ${formId}`
}

const field = (id: string, type: string, label: string, extra: Json = {}) => ({ id, type, label, required: false, props: {}, ...extra })

async function newForm(as: Role = 'owner', body: Json = {}) {
  const res = await call(as, 'POST', '/api/forms', body)
  expect(res.status).toBe(201)
  return res.body as { id: string; slug: string; title: string }
}

async function revisionOf(id: string) {
  return (await call('owner', 'GET', `/api/forms/${id}`)).body.revision as number
}

beforeAll(async () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (${role[0].toUpperCase() + role.slice(1)}, ${`${role}@example.com`}, 'x', ${role}) RETURNING id
    `
    userIds[role] = u.id
    tokens[role] = randomToken()
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${hashToken(tokens[role])}, ${u.id}, now() + interval '1 day')`
  }
})

afterAll(async () => {
  await ctx.teardown()
})

describe('roles', () => {
  it('needs a session', async () => {
    expect((await call(null, 'GET', '/api/forms')).status).toBe(401)
  })

  it('lets a Viewer read but never write', async () => {
    const form = await newForm()
    expect((await call('viewer', 'GET', '/api/forms')).status).toBe(200)
    expect((await call('viewer', 'GET', `/api/forms/${form.id}`)).status).toBe(200)
    expect((await call('viewer', 'GET', '/api/templates')).status).toBe(200)

    const writes: [string, string, unknown?][] = [
      ['POST', '/api/forms', {}],
      ['PATCH', `/api/forms/${form.id}`, { title: 'Nope' }],
      ['POST', `/api/forms/${form.id}/publish`],
      ['POST', `/api/forms/${form.id}/close`],
      ['POST', `/api/forms/${form.id}/reopen`],
      ['POST', `/api/forms/${form.id}/duplicate`],
      ['POST', `/api/forms/${form.id}/save-as-template`, {}],
      ['DELETE', `/api/forms/${form.id}`, { confirmTitle: form.title }],
    ]
    for (const [method, path, body] of writes) {
      const res = await call('viewer', method, path, body)
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('lets an Editor create and edit', async () => {
    const form = await newForm('editor')
    expect((await call('editor', 'PATCH', `/api/forms/${form.id}`, { title: 'Edited' })).status).toBe(200)
  })

  it('hides the webhook URL and header values from a Viewer', async () => {
    const form = await newForm()
    const url = 'https://hooks.example.com/services/T000/B000/s3cr3tpath'
    const webhook = { url, enabled: true, headers: [{ key: 'Authorization', value: 'Bearer tok_live_123' }] }
    const saved = await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { webhook } })
    expect(saved.status).toBe(200)
    expect(saved.body.settings).toMatchObject({ webhook, webhookRedacted: false })

    const viewer = await call('viewer', 'GET', `/api/forms/${form.id}`)
    expect(viewer.status).toBe(200)
    expect(viewer.body.settings.webhook).toEqual({ enabled: true, url: null, headers: [{ key: 'Authorization', value: '' }] })
    expect(viewer.body.settings.webhookRedacted).toBe(true)
    for (const path of [`/api/forms/${form.id}`, '/api/forms', '/api/templates']) {
      const text = JSON.stringify((await call('viewer', 'GET', path)).body)
      expect(text, path).not.toContain('s3cr3tpath')
      expect(text, path).not.toContain('tok_live_123')
    }

    for (const role of ['owner', 'editor'] as const) {
      const res = await call(role, 'GET', `/api/forms/${form.id}`)
      expect(res.body.settings, role).toMatchObject({ webhook, webhookRedacted: false })
    }
  })
})

describe('create', () => {
  it('creates a blank draft with a random 8-character slug and safe defaults', async () => {
    const form = await newForm()
    expect(form.slug).toMatch(/^[a-z0-9]{8}$/)
    expect(form.title).toBe('Untitled form')
    const { body } = await call('owner', 'GET', `/api/forms/${form.id}`)
    expect(body.status).toBe('draft')
    expect(body.revision).toBe(0)
    expect(body.publishedVersion).toBeNull()
    expect(body.settings.turnstile).toBe(true)
    expect(body.settings.noindex).toBe(true)
    expect(body.settings).not.toHaveProperty('passwordHash')
    expect(body.counts).toEqual({ fields: 0, logicRules: 0, responses: 0 })
  })

  it('creates from a built-in template by slug, keeping its notes', async () => {
    const form = await newForm('owner', { templateSlug: 'builtin-lead-capture' })
    expect(form.title).toBe('Lead capture')
    const { body } = await call('owner', 'GET', `/api/forms/${form.id}`)
    expect(body.draft.layout).toBe('one_at_a_time')
    expect(body.settings.onePerEmail).toBe(true)
    expect(body.draft.fields.map((f: Json) => f.id)).toContain(body.settings.onePerEmailFieldId)
    expect(body.status).toBe('draft')
    // Fresh ids per form: never the template's own.
    expect(body.draft.fields.map((f: Json) => f.id)).not.toContain('f_lcemail')
    const again = (await call('owner', 'GET', `/api/forms/${(await newForm('owner', { templateSlug: 'builtin-lead-capture' })).id}`)).body
    expect(again.draft.fields[0].id).not.toBe(body.draft.fields[0].id)
    expect(again.draft.fields[1].label).toContain(`{${again.draft.fields[0].id}.first|there}`)
  })

  it('uses the App settings default theme and timezone for new forms', async () => {
    const { setSetting } = await import('../lib/settings')
    await setSetting('branding', { defaultThemeId: 'linen' })
    await setSetting('general', { timezone: 'Asia/Dhaka' })
    try {
      const { body } = await call('owner', 'GET', `/api/forms/${(await newForm()).id}`)
      expect(body.theme.colors.background).toBe('#FAF8F3')
      expect(body.settings.timezone).toBe('Asia/Dhaka')
    } finally {
      await setSetting('branding', { defaultThemeId: null })
      await setSetting('general', { timezone: 'UTC' })
    }
  })

  it('404s an unknown template', async () => {
    expect((await call('owner', 'POST', '/api/forms', { templateSlug: 'no-such-template' })).status).toBe(404)
  })
})

describe('slug rules', () => {
  it('keeps the old slug as a redirect and rejects taken slugs', async () => {
    const a = await newForm()
    const b = await newForm()

    const changed = await call('owner', 'PATCH', `/api/forms/${a.id}`, { slug: 'spring-survey' })
    expect(changed.status).toBe(200)
    expect(changed.body.slug).toBe('spring-survey')
    const [old] = await sql`SELECT form_id FROM form_slugs_old WHERE slug = ${a.slug}`
    expect(old.form_id).toBe(a.id)

    const taken = await call('owner', 'PATCH', `/api/forms/${b.id}`, { slug: 'spring-survey' })
    expect(taken.status).toBe(422)
    expect(taken.body.error.fields.slug).toBeDefined()

    const takenOld = await call('owner', 'PATCH', `/api/forms/${b.id}`, { slug: a.slug })
    expect(takenOld.status).toBe(422)
    expect(takenOld.body.error.fields.slug).toBeDefined()

    const invalid = await call('owner', 'PATCH', `/api/forms/${b.id}`, { slug: 'Not a slug!' })
    expect(invalid.status).toBe(422)

    // A form may take back its own old slug.
    const back = await call('owner', 'PATCH', `/api/forms/${a.id}`, { slug: a.slug })
    expect(back.status).toBe(200)
    const rows = await sql`SELECT slug FROM form_slugs_old WHERE form_id = ${a.id} ORDER BY slug`
    expect(rows.map((r) => r.slug)).toEqual(['spring-survey'])
  })
})

describe('autosave revisions', () => {
  it('always writes, bumps the revision and reports an overwrite', async () => {
    const form = await newForm()
    const r0 = await revisionOf(form.id)

    const first = await call('owner', 'PATCH', `/api/forms/${form.id}`, { title: 'Mine' }, { 'if-match': `"${r0}"` })
    expect(first.body).toMatchObject({ revision: r0 + 1, overwrote: false, overwrittenBy: null })

    // The editor still holds r0: last save wins, and they learn whose save they replaced.
    const stale = await call('editor', 'PATCH', `/api/forms/${form.id}`, { title: 'Theirs' }, { 'if-match': `"${r0}"` })
    expect(stale.status).toBe(200)
    expect(stale.body).toMatchObject({ revision: r0 + 2, overwrote: true, overwrittenBy: { id: userIds.owner, name: 'Owner' } })

    const [row] = await sql`SELECT title, updated_by FROM forms WHERE id = ${form.id}`
    expect(row).toMatchObject({ title: 'Theirs', updated_by: userIds.editor })
  })

  it('fills missing field props with defaults and rejects broken drafts', async () => {
    const form = await newForm()
    const draft = { layout: 'all_at_once', fields: [field('f_abcd1234', 'rating', 'How was it?')] }
    const ok = await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft })
    expect(ok.status).toBe(200)
    const { body } = await call('owner', 'GET', `/api/forms/${form.id}`)
    expect(body.draft.fields[0].props).not.toEqual({})
    expect(body.draft.endScreen).toBeDefined()

    const bad = await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft: { layout: 'sideways', fields: [] } })
    expect(bad.status).toBe(422)
  })

  it('hashes a password, never returns it, and clears it with null', async () => {
    const form = await newForm()
    const set = await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { password: 'open sesame', closedMessage: 'Shut' } })
    expect(set.status).toBe(200)
    expect(set.body.settings.hasPassword).toBe(true)
    expect(JSON.stringify(set.body)).not.toContain('open sesame')
    const [row] = await sql<{ settings: Json }[]>`SELECT settings FROM forms WHERE id = ${form.id}`
    expect(row.settings.passwordHash).toMatch(/^\$argon2id\$/)
    expect(row.settings.closedMessage).toBe('Shut')

    const read = await call('owner', 'GET', `/api/forms/${form.id}`)
    expect(read.body.settings.hasPassword).toBe(true)
    expect(JSON.stringify(read.body)).not.toContain('argon2')

    const cleared = await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { password: null } })
    expect(cleared.body.settings.hasPassword).toBe(false)
  })

  it('rejects server-only settings keys and invalid values', async () => {
    const form = await newForm()
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { passwordHash: 'x' } })).status).toBe(422)
    // New passwords need 8 characters (existing shorter ones keep working).
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { password: '1234567' } })).status).toBe(422)
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { password: '12345678' } })).status).toBe(200)
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { webhook: { url: 'ftp://x' } } })).status).toBe(422)
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { webhook: { enabled: true } } })).status).toBe(422)
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { afterSubmit: 'redirect' } })).status).toBe(422)
  })
})

describe('publish', () => {
  it('copies the draft into a new version and goes live', async () => {
    const form = await newForm()
    const empty = await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    expect(empty.status).toBe(422)

    await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft: { layout: 'all_at_once', fields: [field('f_name0001', 'short_text', 'Name')] } })
    const first = await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ version: 1, status: 'live' })

    let detail = (await call('owner', 'GET', `/api/forms/${form.id}`)).body
    expect(detail).toMatchObject({ status: 'live', publishedVersion: 1, hasUnpublished: false })

    await call('owner', 'PATCH', `/api/forms/${form.id}`, {
      draft: { layout: 'all_at_once', fields: [field('f_name0001', 'short_text', 'Your name')] },
    })
    detail = (await call('owner', 'GET', `/api/forms/${form.id}`)).body
    expect(detail.hasUnpublished).toBe(true)

    const second = await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    expect(second.body.version).toBe(2)
    const versions = await sql`SELECT version, definition FROM form_versions WHERE form_id = ${form.id} ORDER BY version`
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    expect(versions[0].definition.fields[0].label).toBe('Name')
    expect(versions[1].definition.fields[0].label).toBe('Your name')
  })

  it('blocks publish on logic issues and lists them', async () => {
    const form = await newForm()
    const draft = {
      layout: 'all_at_once',
      fields: [
        field('f_first001', 'short_text', 'First', { logic: { action: 'show', match: 'all', conditions: [{ field: 'f_later001', op: 'is_not_empty' }] } }),
        field('f_later001', 'short_text', 'Later'),
      ],
    }
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft })).status).toBe(200)
    const res = await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('logic_issues')
    expect(res.body.error.issues.length).toBeGreaterThan(0)
  })

  it('closes and reopens', async () => {
    const form = await newForm()
    expect((await call('owner', 'POST', `/api/forms/${form.id}/close`)).status).toBe(409)
    await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft: { layout: 'all_at_once', fields: [field('f_q0000001', 'short_text', 'Q')] } })
    await call('owner', 'POST', `/api/forms/${form.id}/publish`)

    expect((await call('editor', 'POST', `/api/forms/${form.id}/close`)).body.status).toBe('closed')
    let detail = (await call('owner', 'GET', `/api/forms/${form.id}`)).body
    expect(detail.status).toBe('closed')
    expect(detail.settings.closed).toBe(true)

    expect((await call('editor', 'POST', `/api/forms/${form.id}/reopen`)).body.status).toBe('live')
    detail = (await call('owner', 'GET', `/api/forms/${form.id}`)).body
    expect(detail.settings.closed).toBe(false)
  })

  it('refuses to reopen a form at its response cap until the cap is raised', async () => {
    const form = await newForm()
    await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft: { layout: 'all_at_once', fields: [field('f_q0000001', 'short_text', 'Q')] }, settings: { responseCap: 1 } })
    await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    await addResponse(form.id)
    await sql`UPDATE forms SET status = 'closed' WHERE id = ${form.id}`

    const res = await call('editor', 'POST', `/api/forms/${form.id}/reopen`)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'cap_reached', message: 'Raise or remove the response cap first' })
    expect((await call('owner', 'GET', `/api/forms/${form.id}`)).body.status).toBe('closed')

    await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { responseCap: 2 } })
    expect((await call('editor', 'POST', `/api/forms/${form.id}/reopen`)).body.status).toBe('live')
  })

  it('has no language or label settings', async () => {
    const form = await newForm()
    const { settings } = (await call('owner', 'GET', `/api/forms/${form.id}`)).body
    expect(settings).not.toHaveProperty('language')
    expect(settings).not.toHaveProperty('labels')
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { language: 'de' } })).status).toBe(422)
    expect((await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { labels: { submit: 'Senden' } } })).status).toBe(422)
  })
})

describe('duplicate', () => {
  it('copies definition, theme and settings, never responses or the webhook secret', async () => {
    const form = await newForm()
    await call('owner', 'PATCH', `/api/forms/${form.id}`, {
      title: 'Feedback',
      draft: { layout: 'one_at_a_time', fields: [field('f_q0000001', 'short_text', 'Q')] },
      settings: { webhook: { url: 'https://example.com/hook', enabled: true }, closedMessage: 'Done' },
    })
    await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    await addResponse(form.id)
    await sql`UPDATE forms SET webhook_secret = 'v1.encrypted' WHERE id = ${form.id}`

    const copy = await call('editor', 'POST', `/api/forms/${form.id}/duplicate`)
    expect(copy.status).toBe(201)
    expect(copy.body.title).toBe('Copy of Feedback')
    expect(copy.body.slug).not.toBe(form.slug)

    const detail = (await call('owner', 'GET', `/api/forms/${copy.body.id}`)).body
    expect(detail).toMatchObject({ status: 'draft', publishedVersion: null })
    expect(detail.counts.responses).toBe(0)
    expect(detail.draft.layout).toBe('one_at_a_time')
    expect(detail.settings.closedMessage).toBe('Done')
    expect(detail.settings.webhook).toMatchObject({ url: 'https://example.com/hook', enabled: true })
    const [copied] = await sql`SELECT webhook_secret FROM forms WHERE id = ${copy.body.id}`
    expect(copied.webhook_secret).toBeNull()
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM responses WHERE form_id = ${copy.body.id}`
    expect(n).toBe(0)
  })
})

describe('delete', () => {
  it('requires the exact title and removes responses', async () => {
    const form = await newForm('owner', { title: 'Delete me' })
    await call('owner', 'PATCH', `/api/forms/${form.id}`, { draft: { layout: 'all_at_once', fields: [field('f_q0000001', 'short_text', 'Q')] } })
    await call('owner', 'POST', `/api/forms/${form.id}/publish`)
    await addResponse(form.id)

    const wrong = await call('owner', 'DELETE', `/api/forms/${form.id}`, { confirmTitle: 'delete me' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error.fields.confirmTitle).toBeDefined()
    expect((await call('owner', 'DELETE', `/api/forms/${form.id}`)).status).toBe(400)

    expect((await call('editor', 'DELETE', `/api/forms/${form.id}`, { confirmTitle: 'Delete me' })).status).toBe(204)
    expect((await call('owner', 'GET', `/api/forms/${form.id}`)).status).toBe(404)
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM responses WHERE form_id = ${form.id}`
    expect(n).toBe(0)
  })
})

describe('list', () => {
  it('searches, filters, sorts and reports counts and the weekly strip', async () => {
    const zeta = await newForm('owner', { title: 'Zeta poll' })
    await newForm('owner', { title: 'Alpha 100% survey' })
    await call('owner', 'PATCH', `/api/forms/${zeta.id}`, { draft: { layout: 'all_at_once', fields: [field('f_q0000001', 'short_text', 'Q')] } })
    await call('owner', 'POST', `/api/forms/${zeta.id}/publish`)
    await addResponse(zeta.id)
    // Starts come from the rollup (raw events are purged after 30 days).
    await sql`INSERT INTO form_event_counts (form_id, bucket, views, starts) VALUES (${zeta.id}, now() - interval '90 days', 0, 3), (${zeta.id}, now(), 0, 1)`

    const search = (await call('viewer', 'GET', '/api/forms?q=zeta')).body
    expect(search.forms).toHaveLength(1)
    expect(search.forms[0]).toMatchObject({ title: 'Zeta poll', status: 'live', responseCount: 1, completionRate: 0.25, newThisWeek: 1, layout: 'all_at_once' })
    expect(search.total).toBeGreaterThan(1)

    // % and _ are literal in search.
    expect((await call('owner', 'GET', '/api/forms?q=100%25')).body.forms.map((f: Json) => f.title)).toEqual(['Alpha 100% survey'])

    const live = (await call('owner', 'GET', '/api/forms?status=live')).body.forms as Json[]
    expect(live.every((f) => f.status === 'live')).toBe(true)

    const byTitle = (await call('owner', 'GET', '/api/forms?sort=title')).body.forms as Json[]
    const titles = byTitle.map((f) => f.title.toLowerCase())
    expect(titles).toEqual([...titles].sort())

    const strip = (await call('owner', 'GET', '/api/forms/strip')).body
    expect(strip.responsesThisWeek).toBeGreaterThanOrEqual(1)
    expect(strip.mostActive.length).toBeGreaterThan(0)
    expect(strip.mostActive.find((f: Json) => f.id === zeta.id)).toMatchObject({ status: 'live', completionRate: 0.25 })
    // Seven calendar days, today last, and today holds the new response.
    expect(strip.days).toHaveLength(7)
    expect(strip.days.at(-1).count).toBeGreaterThanOrEqual(1)
    expect(strip.counts.all).toBe(strip.counts.live + strip.counts.draft + strip.counts.closed)
    expect(strip.counts.live).toBeGreaterThanOrEqual(1)
    expect(strip.avgCompletion).toBeGreaterThan(0)
  })

  it('pages the list without repeating a form', async () => {
    // 30 forms sharing one updated_at: only the id tiebreaker keeps the pages apart.
    await sql`
      INSERT INTO forms (slug, title, draft, updated_at)
      SELECT 'paged-' || n, 'Paged ' || n, '{}'::jsonb, '2026-01-01T00:00:00Z' FROM generate_series(1, 30) n
    `
    const first = (await call('viewer', 'GET', '/api/forms?q=Paged')).body
    const second = (await call('viewer', 'GET', '/api/forms?q=Paged&page=2')).body
    expect(first).toMatchObject({ matched: 30, page: 1, pageSize: 24 })
    expect(first.forms).toHaveLength(24)
    expect(second.forms).toHaveLength(6)
    const ids = [...first.forms, ...second.forms].map((f: Json) => f.id)
    expect(new Set(ids).size).toBe(30)
    expect((await call('viewer', 'GET', '/api/forms?q=Paged&page=9')).body).toMatchObject({ forms: [], matched: 30 })
  })

  it('remembers grid or list per user', async () => {
    expect((await call('viewer', 'GET', '/api/forms/prefs/view')).body.view).toBe('grid')
    expect((await call('viewer', 'PATCH', '/api/forms/prefs/view', { view: 'list' })).status).toBe(200)
    expect((await call('viewer', 'GET', '/api/forms/prefs/view')).body.view).toBe('list')
    expect((await call('owner', 'GET', '/api/forms/prefs/view')).body.view).toBe('grid')
  })
})

describe('templates', () => {
  it('lists the 10 built-ins, protects them, and manages saved ones', async () => {
    const list = (await call('viewer', 'GET', '/api/templates')).body
    const builtins = list.templates.filter((t: Json) => t.isBuiltin)
    expect(builtins).toHaveLength(10)
    expect(list.categories).toContain('Marketing')

    expect((await call('owner', 'DELETE', `/api/templates/${builtins[0].id}`)).status).toBe(403)
    expect((await call('owner', 'PATCH', `/api/templates/${builtins[0].id}`, { name: 'Mine' })).status).toBe(403)

    const form = await newForm('owner', { title: 'Team survey' })
    await call('owner', 'PATCH', `/api/forms/${form.id}`, { settings: { password: 'secret-12', webhook: { url: 'https://example.com/h', enabled: true } } })
    const saved = await call('editor', 'POST', `/api/forms/${form.id}/save-as-template`, {})
    expect(saved.status).toBe(201)
    expect(saved.body).toMatchObject({ name: 'Team survey', isBuiltin: false, category: 'Saved' })
    const [tpl] = await sql<{ settings: Json }[]>`SELECT settings FROM templates WHERE id = ${saved.body.id}`
    expect(tpl.settings.passwordHash).toBeNull()
    expect(tpl.settings.webhook).toEqual({ enabled: false, url: null, headers: [] })

    expect((await call('viewer', 'PATCH', `/api/templates/${saved.body.id}`, { name: 'X' })).status).toBe(403)
    expect((await call('owner', 'PATCH', `/api/templates/${saved.body.id}`, { name: 'Renamed' })).status).toBe(200)
    const fromSaved = await newForm('editor', { templateId: saved.body.id })
    expect(fromSaved.title).toBe('Renamed')
    expect((await call('owner', 'DELETE', `/api/templates/${saved.body.id}`)).status).toBe(204)
  })

  it('re-seeding is idempotent, writes only changed rows and drops retired built-ins', async () => {
    const { seedBuiltinTemplates } = await import('../db/seed')
    await seedBuiltinTemplates(sql)
    expect(await seedBuiltinTemplates(sql)).toEqual({ written: 0, deleted: 0 })

    await sql`UPDATE templates SET name = 'Tampered', builtin_hash = 'old' WHERE slug = 'builtin-nps'`
    await sql`INSERT INTO templates (slug, name, category, definition, is_builtin) VALUES ('nps', 'Old NPS', 'Feedback', '{}'::jsonb, true)`
    await sql`INSERT INTO templates (slug, name, category, definition, is_builtin) VALUES ('saved-keepme', 'Mine', 'Saved', '{}'::jsonb, false)`
    expect(await seedBuiltinTemplates(sql)).toEqual({ written: 1, deleted: 1 })

    const rows = await sql`SELECT slug, name FROM templates WHERE slug IN ('builtin-nps', 'nps', 'saved-keepme') ORDER BY slug`
    expect(rows).toEqual([{ slug: 'builtin-nps', name: 'NPS' }, { slug: 'saved-keepme', name: 'Mine' }])
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM templates WHERE is_builtin`
    expect(n).toBe(10)
  })
})
