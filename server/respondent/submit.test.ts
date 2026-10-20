import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Respondent API against a fresh migrated database per run (server/test/harness.ts). Locally the
 * base is intelform_e; CI sets TEST_DATABASE_URL.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_e'
process.env.TEST_APP_URL ??= 'http://localhost:5185'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const { setupTestDb } = await import('../test/harness')
const ctx = await setupTestDb()
const { sql } = ctx
const { formDefinition } = await import('../../shared/form/definition')
const { defaultFormSettings } = await import('../../shared/form/settings')
const { defaultTheme } = await import('../../shared/form/theme')
const { renderToken } = await import('./tokens')
const { hashPassword } = await import('../lib/password')
const { setTestEmailDriver } = await import('../lib/email')
const { setSetting } = await import('../lib/settings')
const { encryptSecret } = await import('../lib/crypto')
const { setTurnstileFetch } = await import('./turnstile')
const { localFilePath } = await import('../lib/uploads')
const { existsSync, readdirSync } = await import('node:fs')
const { hashIp } = await import('../lib/crypto')

// A 1×1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const DEF = {
  layout: 'all_at_once',
  startScreen: { enabled: false, title: '', button: 'Start' },
  endScreen: { title: 'Thanks, {f_name.first|friend}!', message: '' },
  labels: {},
  fields: [
    { id: 'f_name', type: 'name', label: 'Your name', required: true, props: { split: true } },
    { id: 'f_email', type: 'email', label: 'Email', required: true },
    { id: 'f_more', type: 'yes_no', label: 'Tell us more?' },
    {
      id: 'f_detail',
      type: 'long_text',
      label: 'Details',
      logic: { action: 'show', match: 'all', conditions: [{ field: 'f_more', op: 'is_yes' }] },
    },
    { id: 'f_pick', type: 'single_choice', label: 'Pick', props: { options: [{ id: 'o_aa', label: 'A' }, { id: 'o_bb', label: 'B' }], other: true } },
    { id: 'f_sign', type: 'signature', label: 'Sign' },
    { id: 'f_okay', type: 'consent', label: 'Consent', props: { text: 'I agree' } },
  ],
}

let seq = 0
async function makeForm(settings: Json = {}, opts: { status?: string; definition?: Json } = {}) {
  const slug = `t-${++seq}-${Math.random().toString(36).slice(2, 8)}`
  const definition = formDefinition.parse(opts.definition ?? DEF)
  const s = { ...defaultFormSettings(), turnstile: false, ...settings }
  const [form] = await sql<{ id: string }[]>`
    INSERT INTO forms (slug, title, status, draft, settings, theme)
    VALUES (${slug}, ${'Survey ' + seq}, ${opts.status ?? 'live'}, ${sql.json(definition as never)}, ${sql.json(s as never)}, ${sql.json(defaultTheme() as never)})
    RETURNING id
  `
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${form.id}, 1, ${sql.json(definition as never)}, ${sql.json(defaultTheme() as never)}) RETURNING id
  `
  await sql`UPDATE forms SET published_version_id = ${v.id} WHERE id = ${form.id}`
  return { id: form.id, slug, versionId: v.id }
}

const good = (extra: Json = {}) => ({ f_name: { first: 'Ada', last: 'Lovelace' }, f_email: 'Ada@Example.com', ...extra })

function body(form: { id: string; versionId: string }, answers: Json, extra: Json = {}) {
  return { formVersionId: form.versionId, answers, renderToken: renderToken(form.id, Date.now() - 5000), startedAt: Date.now() - 4000, ttc: { f_email: 1200, f_nope: 4 }, ...extra }
}

const count = async (formId: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM responses WHERE form_id = ${formId}`)[0].n

beforeAll(async () => {
  await sql`INSERT INTO users (name, email, password_hash, role) VALUES ('Owner', 'owner@example.com', 'x', 'owner')`
})
afterAll(async () => {
  setTestEmailDriver(undefined)
  setTurnstileFetch(null)
  await ctx.teardown()
})

describe('GET /api/public/forms/:slug', () => {
  it('returns the published definition, labels and public settings only', async () => {
    const form = await makeForm({ passwordHash: null, notifyRecipients: [] })
    const res = await ctx.client().get(`/api/public/forms/${form.slug}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('live')
    expect(res.body.definition.fields).toHaveLength(7)
    expect(res.body.labels.submit).toBe('Submit')
    expect(res.body.renderToken).toMatch(/^\d+\./)
    expect(res.body.settings).not.toHaveProperty('passwordHash')
    expect(res.body.settings).not.toHaveProperty('webhook')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('404s drafts and unknown slugs, and points old slugs at the new one', async () => {
    const draft = await makeForm({}, { status: 'draft' })
    expect((await ctx.client().get(`/api/public/forms/${draft.slug}`)).status).toBe(404)
    expect((await ctx.client().get('/api/public/forms/nope-nope')).status).toBe(404)
    const form = await makeForm()
    await sql`INSERT INTO form_slugs_old (slug, form_id) VALUES ('old-link', ${form.id})`
    const res = await ctx.client().get('/api/public/forms/old-link')
    expect(res.body).toEqual({ status: 'moved', redirectTo: form.slug })
  })

  it('shows the closed message when closed, past the close date or at the cap', async () => {
    const closed = await makeForm({ closedMessage: 'See you next year.' }, { status: 'closed' })
    const r1 = await ctx.client().get(`/api/public/forms/${closed.slug}`)
    expect(r1.body).toMatchObject({ status: 'closed', message: 'See you next year.' })
    expect(r1.body).not.toHaveProperty('definition')
    const past = await makeForm({ closeAt: new Date(Date.now() - 1000).toISOString() })
    expect((await ctx.client().get(`/api/public/forms/${past.slug}`)).body.status).toBe('closed')
    const capped = await makeForm({ responseCap: 1 })
    await sql`UPDATE forms SET response_count = 1 WHERE id = ${capped.id}`
    expect((await ctx.client().get(`/api/public/forms/${capped.slug}`)).body.status).toBe('closed')
  })
})

describe('password protection', () => {
  it('returns metadata only until unlocked, then accepts the token', async () => {
    const form = await makeForm({ passwordHash: await hashPassword('open sesame') })
    const c = ctx.client()
    const locked = await c.get(`/api/public/forms/${form.slug}`)
    expect(locked.body.status).toBe('locked')
    expect(locked.body).not.toHaveProperty('definition')
    expect(locked.body.settings.passwordRequired).toBe(true)

    const wrong = await c.post(`/api/public/forms/${form.slug}/unlock`, { password: 'nope' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error.fields.password[0]).toMatch(/password/)

    const ok = await c.post(`/api/public/forms/${form.slug}/unlock`, { password: 'open sesame' })
    expect(ok.status).toBe(200)
    expect(ok.body.form.status).toBe('live')
    const token = ok.body.token as string

    const again = await c.get(`/api/public/forms/${form.slug}`, { headers: { 'x-intelform-unlock': token } })
    expect(again.body.status).toBe('live')

    expect((await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good()))).status).toBe(401)
    expect((await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { unlockToken: token }))).status).toBe(200)
    expect(await count(form.id)).toBe(1)
  })
})

describe('POST /api/public/forms/:slug/responses', () => {
  it('stores a valid response with metadata, ttc, search text, consent stamp and the counter', async () => {
    const form = await makeForm()
    const res = await ctx.client().post(
      `/api/public/forms/${form.slug}/responses`,
      body(form, good({ f_pick: { option: 'o_other', other: 'Carrots' }, f_okay: { accepted: true, at: '2001-01-01T00:00:00Z' } }), { browserToken: 'tok-1' }),
      { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' } },
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const [r] = await sql<Json[]>`SELECT * FROM responses WHERE form_id = ${form.id}`
    expect(r.answers.f_email).toBe('ada@example.com')
    expect(r.answers.f_okay).toMatchObject({ accepted: true, text: 'I agree', version: 1 })
    expect(r.answers.f_okay.at).not.toBe('2001-01-01T00:00:00Z')
    expect(r.ttc).toEqual({ f_email: 1200 })
    expect(r.search_text).toContain('Ada Lovelace')
    expect(r.search_text).toContain('Carrots')
    expect(r.duration_ms).toBeGreaterThan(3000)
    expect(r.ip_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(r.device).toBe('mobile')
    expect(r.browser_token).toMatch(/^[0-9a-f]{40}$/)
    const [f] = await sql<Json[]>`SELECT response_count, last_response_at FROM forms WHERE id = ${form.id}`
    expect(f.response_count).toBe(1)
    expect(f.last_response_at).not.toBeNull()
  })

  it('returns 422 keyed by field id, and rejects answers to hidden fields', async () => {
    const form = await makeForm()
    const missing = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, { f_email: 'not-an-email' }))
    expect(missing.status).toBe(422)
    expect(Object.keys(missing.body.error.fields).sort()).toEqual(['f_email', 'f_name'])
    expect(missing.body.error.fields.f_email[0]).toMatch(/email address/)

    const hidden = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_more: false, f_detail: 'sneaky' })))
    expect(hidden.status).toBe(422)
    expect(hidden.body.error.fields).toHaveProperty('f_detail')

    const shown = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_more: true, f_detail: 'fine' })))
    expect(shown.status).toBe(200)
    expect(await count(form.id)).toBe(1)
  })

  it('fakes success for the honeypot and too-fast submits, keeping nothing', async () => {
    const form = await makeForm()
    const c = ctx.client()
    const hp = await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { hp: 'http://spam.example' }))
    expect(hp.status).toBe(200)
    expect(hp.body).toEqual({ ok: true })
    const fast = await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { renderToken: renderToken(form.id) }))
    expect(fast.status).toBe(200)
    const forged = await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { renderToken: `${Date.now() - 9000}.forged` }))
    expect(forged.status).toBe(200)
    expect(await count(form.id)).toBe(0)
  })

  it('rate limits to 10 per minute per IP per form', async () => {
    const form = await makeForm()
    const c = ctx.client()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_email: `p${i}@example.com` })))).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
    // Another IP is unaffected.
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))).status).toBe(200)
  })

  it('lets only one of two simultaneous submits with the same email through', async () => {
    const form = await makeForm({ onePerEmail: true, onePerEmailFieldId: 'f_email' })
    const send = () => ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_email: 'race@example.com' })))
    const results = await Promise.all([send(), send(), send()])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 422, 422])
    const rejected = results.find((r) => r.status === 422)!
    expect(rejected.body.error.fields.f_email[0]).toMatch(/already responded/)
    expect(await count(form.id)).toBe(1)
    // A different email still works.
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_email: 'other@example.com' })))).status).toBe(200)
  })

  it('blocks a second response from the same browser token when one-per-browser is on', async () => {
    const form = await makeForm({ onePerBrowser: true })
    const c = ctx.client()
    expect((await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { browserToken: 'b-1' }))).status).toBe(200)
    const again = await c.post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { browserToken: 'b-1' }))
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('already_responded')
  })

  it('closes the form when the cap is reached', async () => {
    const form = await makeForm({ responseCap: 2 })
    for (let i = 0; i < 2; i++) {
      expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))).status).toBe(200)
    }
    const [f] = await sql<Json[]>`SELECT status, response_count FROM forms WHERE id = ${form.id}`
    expect(f).toMatchObject({ status: 'closed', response_count: 2 })
    const late = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))
    expect(late.status).toBe(403)
    expect(late.body.error.code).toBe('form_closed')
  })

  it('uploads signatures with the local disk driver and stores the URL', async () => {
    const form = await makeForm()
    const res = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: PNG } })))
    expect(res.status).toBe(200)
    const [r] = await sql<Json[]>`SELECT answers FROM responses WHERE form_id = ${form.id}`
    const url = r.answers.f_sign.url as string
    expect(url).toMatch(/^\/api\/uploads\/files\/intelform\/signatures\/.+\.png$/)
    expect(existsSync(localFilePath(url.slice('/api/uploads/files/'.length))!)).toBe(true)
  })

  it('validates against the version the browser rendered', async () => {
    const form = await makeForm()
    const v2def = formDefinition.parse({ ...DEF, fields: [{ id: 'f_newer', type: 'short_text', label: 'New', required: true }] })
    const [v2] = await sql<{ id: string }[]>`
      INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${form.id}, 2, ${sql.json(v2def as never)}, '{}') RETURNING id
    `
    await sql`UPDATE forms SET published_version_id = ${v2.id} WHERE id = ${form.id}`
    // Rendered v1 before the republish: still accepted against v1.
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))).status).toBe(200)
    const unknown = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body({ ...form, versionId: '00000000-0000-4000-8000-000000000000' }, good()))
    expect(unknown.status).toBe(409)
  })

  it('queues the owner email, the confirmation and the webhook in the same transaction', async () => {
    const sent: unknown[] = []
    setTestEmailDriver({ send: async (m) => (sent.push(m), {}), verify: async () => {} })
    const form = await makeForm({
      notifyOnResponse: true,
      confirmationEmail: true,
      confirmationEmailFieldId: 'f_email',
      confirmationSubject: 'Thanks {f_name.first}',
      confirmationBody: 'Hi {f_name.first}, we got it.',
      webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] },
    })
    const res = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: PNG } })))
    expect(res.status).toBe(200)
    const [r] = await sql<{ id: string }[]>`SELECT id FROM responses WHERE form_id = ${form.id}`
    const jobs = await sql<{ kind: string; payload: Json }[]>`SELECT kind, payload FROM jobs WHERE created_at > now() - interval '1 minute' ORDER BY id`
    const emails = jobs.filter((j) => j.kind === 'email').map((j) => j.payload).filter((p) => JSON.stringify(p).includes(r.id) || p.subject === 'Thanks Ada')
    const owner = emails.find((e) => e.to.includes('owner@example.com'))!
    expect(owner.text).toContain(`/dashboard/forms/${form.id}/responses?response=${r.id}`)
    expect(owner.text).toContain('ada@example.com')
    expect(owner.text).toContain(`${process.env.TEST_APP_URL}/api/uploads/files/`)
    const confirmation = emails.find((e) => e.subject === 'Thanks Ada')!
    expect(confirmation).toMatchObject({ to: ['ada@example.com'], text: 'Hi Ada, we got it.' })
    const hook = jobs.find((j) => j.kind === 'webhook' && j.payload.responseId === r.id)!
    expect(hook.payload.payload).toMatchObject({
      form_id: form.id,
      form_version: 1,
      response_id: r.id,
      answers: { f_email: { label: 'Email', type: 'email', value: 'ada@example.com' } },
    })
    expect(hook.payload.payload.submitted_at).toMatch(/^\d{4}-/)
    setTestEmailDriver(undefined)
  })

  it('returns the redirect URL with answers appended, signatures excluded', async () => {
    const form = await makeForm({ afterSubmit: 'redirect', redirectUrl: 'https://example.com/thanks?src=form', redirectAppendAnswers: true })
    const res = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: PNG } })))
    const url = new URL(res.body.redirectUrl)
    expect(url.origin + url.pathname).toBe('https://example.com/thanks')
    expect(url.searchParams.get('src')).toBe('form')
    expect(url.searchParams.get('f_email')).toBe('ada@example.com')
    expect(url.searchParams.get('f_name')).toBe('Ada, Lovelace')
    expect(url.searchParams.has('f_sign')).toBe(false)
  })

  it('verifies Turnstile when on and configured, and skips it when keys are missing', async () => {
    const form = await makeForm({ turnstile: true })
    // No keys yet: no Turnstile.
    expect((await ctx.client().get(`/api/public/forms/${form.slug}`)).body.turnstileSiteKey).toBeNull()
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))).status).toBe(200)

    await setSetting('turnstile', { siteKey: '1x00000000000000000000AA', secret: encryptSecret('1x0000000000000000000000000000000AA') })
    const calls: string[] = []
    setTurnstileFetch(async (_url, init) => {
      const token = new URLSearchParams(String(init?.body)).get('response')!
      calls.push(token)
      return new Response(JSON.stringify({ success: token === 'good', hostname: 'example.com', action: 'submit' }))
    })
    expect((await ctx.client().get(`/api/public/forms/${form.slug}`)).body.turnstileSiteKey).toBe('1x00000000000000000000AA')
    const none = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))
    expect(none.status).toBe(403)
    expect(none.body.error.code).toBe('turnstile_failed')
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { turnstileToken: 'bad' }))).status).toBe(403)
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good(), { turnstileToken: 'good' }))).status).toBe(200)
    // Invalid answers are rejected before Turnstile spends the token.
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, {}, { turnstileToken: 'good' }))).status).toBe(422)
    expect(calls).toEqual(['bad', 'good'])
    await setSetting('turnstile', { siteKey: null, secret: null })
    setTurnstileFetch(null)
  })

  it('rejects oversized answers', async () => {
    const form = await makeForm()
    const res = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_detail: 'x'.repeat(300 * 1024) })))
    expect(res.status).toBe(413)
  })
})

describe('POST /api/public/forms/:slug/events', () => {
  it('records one view and one start per session and rolls them up', async () => {
    const form = await makeForm()
    const c = ctx.client()
    const session = crypto.randomUUID()
    const send = (type: string) =>
      c.request('POST', `/api/public/forms/${form.slug}/events`, undefined, { raw: JSON.stringify({ type, session }), headers: { 'content-type': 'text/plain;charset=UTF-8' } })
    expect((await send('view')).status).toBe(204)
    expect((await send('view')).status).toBe(204)
    expect((await send('start')).status).toBe(204)
    const events = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM form_events WHERE form_id = ${form.id}`
    expect(events[0].n).toBe(2)
    const [roll] = await sql<{ views: number; starts: number }[]>`SELECT sum(views)::int AS views, sum(starts)::int AS starts FROM form_event_counts WHERE form_id = ${form.id}`
    expect(roll).toEqual({ views: 1, starts: 1 })
    expect((await send('bogus')).status).toBe(400)
  })
})

describe('security follow-ups', () => {
  const sigFiles = (formId: string) => {
    const dir = localFilePath(`intelform/signatures/${formId}`)!
    return existsSync(dir) ? readdirSync(dir).length : 0
  }
  /** Sets this window's hit count for the first rate-limit key matching `like`. */
  const fillLimit = (like: string, count: number) => sql`UPDATE rate_limits SET count = ${count} WHERE key LIKE ${like}`

  it('accepts a signature only as a PNG data URL', async () => {
    const form = await makeForm()
    const https = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: 'https://evil.example.com/sig.png' } })))
    expect(https.status).toBe(422)
    expect(https.body.error.fields).toHaveProperty('f_sign')
    // Valid base64 under a PNG content type, but not PNG bytes.
    const fake = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' } })))
    expect(fake.status).toBe(422)
    expect(fake.body.error.fields).toHaveProperty('f_sign')
    expect(sigFiles(form.id)).toBe(0)
    expect(await count(form.id)).toBe(0)
  })

  it('uploads nothing for a submit the one-per-email check rejects', async () => {
    const form = await makeForm({ onePerEmail: true, onePerEmailFieldId: 'f_email' })
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: PNG } })))).status).toBe(200)
    expect(sigFiles(form.id)).toBe(1)
    const again = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good({ f_sign: { url: PNG } })))
    expect(again.status).toBe(422)
    expect(sigFiles(form.id)).toBe(1)
  })

  it('accepts only the current version, or the previous one for 24 hours after a republish', async () => {
    const form = await makeForm()
    const addVersion = async (n: number, publishedAgo: string) => {
      const [v] = await sql<{ id: string }[]>`
        INSERT INTO form_versions (form_id, version, definition, theme, published_at)
        VALUES (${form.id}, ${n}, ${sql.json(formDefinition.parse(DEF) as never)}, '{}', now() - ${publishedAgo}::interval) RETURNING id
      `
      await sql`UPDATE forms SET published_version_id = ${v.id} WHERE id = ${form.id}`
      return v.id
    }
    const v2 = await addVersion(2, '25 hours')
    // v1 was replaced 25 hours ago: too old.
    const stale = await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('version_unknown')
    await addVersion(3, '1 minute')
    // v2 was replaced a minute ago: still fine. v1 is two versions back: reload.
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body({ ...form, versionId: v2 }, good()))).status).toBe(200)
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, good()))).status).toBe(409)
  })

  it('strips links from piped answers and skips confirmations over the hourly cap', async () => {
    setTestEmailDriver({ send: async () => ({}), verify: async () => {} })
    const form = await makeForm({
      confirmationEmail: true,
      confirmationEmailFieldId: 'f_email',
      confirmationSubject: 'Thanks {f_name.first}',
      confirmationBody: 'Hi {f_name.first}. You said: {f_detail} Help: https://owner.example/help',
    })
    const answers = good({
      f_name: { first: 'Win www.spam.example/x', last: 'L' },
      f_more: true,
      f_detail: 'see http://evil.example/claim, evil.com/login or 10.0.0.1/admin, mailto:x@evil.com now',
    })
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, answers))).status).toBe(200)
    const confirmations = async () =>
      (await sql<{ payload: Json }[]>`SELECT payload FROM jobs WHERE kind = 'email' AND created_at > now() - interval '1 minute'`)
        .map((j) => j.payload)
        .filter((p) => p.subject?.startsWith('Thanks Win'))
    const [mail] = await confirmations()
    expect(mail.subject).toBe('Thanks Win')
    // The answers lose every link; the owner's own link in the template stays.
    expect(mail.text).toBe('Hi Win. You said: see or now Help: https://owner.example/help')

    await fillLimit(`confirm:${form.id}`, 200)
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/responses`, body(form, answers))).status).toBe(200)
    expect(await count(form.id)).toBe(2)
    expect(await confirmations()).toHaveLength(1)
    setTestEmailDriver(undefined)
  })

  it('rate limits public GETs per IP, and events before the form is loaded', async () => {
    const form = await makeForm()
    const c = ctx.client()
    expect((await c.get(`/api/public/forms/${form.slug}`)).status).toBe(200)
    await fillLimit(`public-form:${hashIp(c.ip)}`, 300)
    expect((await c.get(`/api/public/forms/${form.slug}`)).status).toBe(429)

    // An unknown slug still spends a hit: the per-IP limit runs before the lookup.
    const res = await c.request('POST', '/api/public/forms/no-such-form/events', undefined, { raw: JSON.stringify({ type: 'view', session: crypto.randomUUID() }), headers: { 'content-type': 'text/plain' } })
    expect(res.status).toBe(404)
    const [hit] = await sql`SELECT 1 FROM rate_limits WHERE key = ${`events:ip:${hashIp(c.ip)}`}`
    expect(hit).toBeTruthy()
  })

  const event = (c: ReturnType<typeof ctx.client>, slug: string) =>
    c.request('POST', `/api/public/forms/${slug}/events`, undefined, { raw: JSON.stringify({ type: 'view', session: crypto.randomUUID() }), headers: { 'content-type': 'text/plain' } })

  it('never keys event limits on the slug: per IP first, then per IP and form', async () => {
    const form = await makeForm()
    const c = ctx.client()
    for (let i = 0; i < 5; i++) expect((await event(c, `made-up-${i}`)).status).toBe(404)
    expect((await event(c, form.slug)).status).toBe(204)
    const keys = (await sql<{ key: string; count: number }[]>`SELECT key, count FROM rate_limits WHERE key LIKE ${`events:%${hashIp(c.ip)}%`}`).map((r) => [r.key, r.count])
    expect(keys.sort()).toEqual([[`events:${hashIp(c.ip)}:${form.id}`, 1], [`events:ip:${hashIp(c.ip)}`, 6]].sort())

    // The per-IP budget covers every slug, real or not.
    await fillLimit(`events:ip:${hashIp(c.ip)}`, 120)
    expect((await event(c, form.slug)).status).toBe(429)
    expect((await event(c, 'another-made-up')).status).toBe(429)
  })

  it('pools an IPv6 /64 into one rate-limit key, and keeps IPv4 per address', async () => {
    const form = await makeForm({ passwordHash: await hashPassword('correct horse') })
    const a = ctx.client('2001:db8:aa:1::1')
    const b = ctx.client('2001:db8:aa:1:ffff:ffff:ffff:fffe')
    const other = ctx.client('2001:db8:aa:2::1')
    for (let i = 0; i < 10; i++) expect((await a.post(`/api/public/forms/${form.slug}/unlock`, { password: `wrong-${i}` })).status).toBe(422)
    // Same /64, different address: same budget.
    expect((await b.post(`/api/public/forms/${form.slug}/unlock`, { password: 'wrong-x' })).status).toBe(429)
    // Next /64 over: its own budget.
    expect((await other.post(`/api/public/forms/${form.slug}/unlock`, { password: 'wrong-y' })).status).toBe(422)
    const [row] = await sql`SELECT 1 FROM rate_limits WHERE key = ${`unlock:${hashIp('2001:db8:aa:1::/64')}:${form.id}`}`
    expect(row).toBeTruthy()

    // Submits from the /64 share one key too.
    const open = await makeForm()
    expect((await a.post(`/api/public/forms/${open.slug}/responses`, body(open, good()))).status).toBe(200)
    expect((await b.post(`/api/public/forms/${open.slug}/responses`, body(open, good()))).status).toBe(200)
    const [respond] = await sql<{ count: number }[]>`SELECT count FROM rate_limits WHERE key = ${`respond:${hashIp('2001:db8:aa:1::/64')}:${open.id}`}`
    expect(respond.count).toBe(2)
    // The stored response hash stays per address.
    const hashes = await sql<{ ip_hash: string }[]>`SELECT ip_hash FROM responses WHERE form_id = ${open.id}`
    expect(new Set(hashes.map((h) => h.ip_hash))).toEqual(new Set([hashIp('2001:db8:aa:1::1'), hashIp('2001:db8:aa:1:ffff:ffff:ffff:fffe')]))
  })

  it('caps wrong passwords per form across all IPs, without counting correct ones', async () => {
    const form = await makeForm({ passwordHash: await hashPassword('correct horse') })
    const key = `unlock-fail:form:${form.id}`
    const failures = async () => (await sql<{ count: number }[]>`SELECT count FROM rate_limits WHERE key = ${key}`)[0]?.count ?? 0
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/unlock`, { password: 'wrong' })).status).toBe(422)
    expect((await ctx.client().post(`/api/public/forms/${form.slug}/unlock`, { password: 'correct horse' })).status).toBe(200)
    expect(await failures()).toBe(1)

    await fillLimit(key, 100)
    // A fresh address, even with the right password, waits for the window to pass.
    const res = await ctx.client().post(`/api/public/forms/${form.slug}/unlock`, { password: 'correct horse' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    // Other forms are unaffected; forms without a password never touch the key.
    const other = await makeForm({ passwordHash: await hashPassword('correct horse') })
    expect((await ctx.client().post(`/api/public/forms/${other.slug}/unlock`, { password: 'correct horse' })).status).toBe(200)
    const open = await makeForm()
    expect((await ctx.client().post(`/api/public/forms/${open.slug}/unlock`, { password: 'anything' })).status).toBe(200)
    const [none] = await sql`SELECT 1 FROM rate_limits WHERE key = ${`unlock-fail:form:${open.id}`}`
    expect(none).toBeUndefined()
  })

  it('exposes the form language', async () => {
    const form = await makeForm({ language: 'de' })
    const res = await ctx.client().get(`/api/public/forms/${form.slug}`)
    expect(res.body.lang).toBe('de')
    expect(res.body.settings.language).toBe('de')
  })
})
