import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OWNER, addMember, insertForm, setupOwner, setupTestDb, type TestClient, type TestContext } from './harness'

/**
 * Security hardening (Agent J): re-verifies the earlier review's findings A3–A13 (A1, A2 and A11 are covered by
 * auth.int.test.ts and team.int.test.ts)
 * (docs/research/06-security-quality.md) and covers the fixes made in this pass.
 */

// Count argon2 hashes (A3: no hashing before the cheap checks). Registered before the app is imported.
let hashCalls = 0
vi.doMock('../lib/password', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/password')>()
  return {
    ...real,
    hashPassword: (p: string) => {
      hashCalls++
      return real.hashPassword(p)
    },
  }
})

let ctx: TestContext
let owner: TestClient
let editor: TestClient
let viewer: TestClient
const sent: { to: string[]; subject: string; text: string }[] = []

beforeAll(async () => {
  ctx = await setupTestDb()
  owner = await setupOwner(ctx)
  editor = await addMember(ctx, owner, 'editor', 'Eddie Editor')
  viewer = await addMember(ctx, owner, 'viewer', 'Vera Viewer')
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

function upload(c: TestClient, purpose: string, data: Buffer | string, name = 'file.bin') {
  const fd = new FormData()
  fd.append('file', new File([typeof data === 'string' ? data : new Uint8Array(data)], name))
  return c.request('POST', `/api/uploads?purpose=${purpose}`, undefined, { raw: fd })
}

// ---------------------------------------------------------------------------
// A1–A13
// ---------------------------------------------------------------------------

describe('earlier findings A1–A13', () => {
  it('A3: dead reset links, used invites and a finished setup never reach argon2', async () => {
    const before = hashCalls
    expect((await ctx.client().post('/api/auth/reset', { token: 'not-a-real-token', password: 'long-enough-1' })).status).toBe(410)
    expect((await ctx.client().post('/api/invites/not-a-real-token/accept', { name: 'X', password: 'long-enough-1' })).status).toBe(410)
    expect((await ctx.client().post('/api/setup', { ...OWNER, email: 'late@example.com' })).status).toBe(409)
    expect(hashCalls).toBe(before)
  })

  it('A4: the dashboard is never framed; forms may be', async () => {
    const { securityHeaders } = await import('../middleware/security-headers')
    const dash = securityHeaders('dashboard')
    expect(dash['X-Frame-Options']).toBe('DENY')
    expect(dash['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    const form = securityHeaders('form')
    expect(form['X-Frame-Options']).toBeUndefined()
    expect(form['Content-Security-Policy']).toContain('frame-ancestors *')
  })

  it('A5: unknown API paths are JSON 404s', async () => {
    const res = await owner.get('/api/definitely-not-a-route')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })

  it('A7: forgot answers the same for known and unknown emails and sends nothing inline', async () => {
    const known = await ctx.client().post('/api/auth/forgot', { email: OWNER.email })
    const unknown = await ctx.client().post('/api/auth/forgot', { email: 'ghost@example.com' })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(known.body).toEqual(unknown.body)
    expect(sent).toHaveLength(0) // queued, not sent in the request
    const [{ n }] = await ctx.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE kind = 'email' AND done_at IS NULL`
    expect(n).toBeGreaterThan(0)
  })

  it('A8: https APP_URL means a Secure __Host- cookie and HSTS; production refuses to start without APP_URL', async () => {
    const run = promisify(execFile)
    const probe = fileURLToPath(new URL('./env-probe.ts', import.meta.url))
    const base = { ...process.env, APP_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none', LOG_LEVEL: 'silent' }
    const https = await run(process.execPath, ['--import', 'tsx', probe], { env: { ...base, NODE_ENV: 'production', APP_URL: 'https://forms.example.com' } })
    expect(JSON.parse(https.stdout)).toEqual({
      isHttps: true,
      appOrigin: 'https://forms.example.com',
      cookie: '__Host-intelform_session',
      hsts: 'max-age=31536000; includeSubDomains',
    })
    const http = await run(process.execPath, ['--import', 'tsx', probe], { env: { ...base, NODE_ENV: 'development', APP_URL: 'http://localhost:5173' } })
    expect(JSON.parse(http.stdout)).toMatchObject({ isHttps: false, cookie: 'intelform_session', hsts: null })
    const env = { ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv
    delete env.APP_URL
    await expect(run(process.execPath, ['--import', 'tsx', probe], { env })).rejects.toMatchObject({ code: 1 })
  }, 60_000)

  it('A9 + A12: a second login ends the first session; sessions store only an IP hash', async () => {
    const c = ctx.client()
    await c.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })
    const first = [...c.cookies.values()][0]
    await c.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })
    const second = [...c.cookies.values()][0]
    expect(second).not.toBe(first)
    const stale = ctx.client()
    stale.cookies.set([...c.cookies.keys()][0], first)
    expect((await stale.get('/api/me')).status).toBe(401)

    const cols = await ctx.sql<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`
    expect(cols.map((r) => r.column_name)).not.toContain('ip')
    const rows = await ctx.sql<{ ip_hash: string | null }[]>`SELECT ip_hash FROM sessions WHERE ip_hash IS NOT NULL`
    for (const r of rows) expect(r.ip_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(rows.some((r) => r.ip_hash === c.ip)).toBe(false)
  })

  it('A10: JSON bodies over 256 KB are refused with 413', async () => {
    const res = await owner.patch('/api/me', { name: 'x'.repeat(300 * 1024) })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('payload_too_large')
  })

  it('A13: a CSRF 403 is JSON and no-store; a cross-site logout is refused', async () => {
    const res = await ctx.client().post('/api/auth/login', undefined, { origin: 'https://evil.example', raw: 'email=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.body.error.code).toBe('request_rejected')
    // No content type at all (e.g. navigator.sendBeacon / no-cors fetch) is treated as a form post.
    expect((await owner.request('POST', '/api/auth/logout', undefined, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await owner.get('/api/me')).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Uploads: path traversal and SVG sanitising
// ---------------------------------------------------------------------------

describe('local file serving', () => {
  it.each([
    '/api/uploads/files/%E0%A4%A', // malformed escape: was a URIError 500
    '/api/uploads/files/%',
    '/api/uploads/files/..%2F..%2Fpackage.json',
    '/api/uploads/files/%2e%2e/%2e%2e/package.json',
    '/api/uploads/files/%252e%252e%252f%252e%252e%252fpackage.json',
    '/api/uploads/files/%2Fetc%2Fpasswd',
    '/api/uploads/files/intelform/..%5C..%5Cpackage.json',
    '/api/uploads/files/',
  ])('%s is a 404', async (path) => {
    const res = await ctx.app.request(path)
    expect(res.status).toBe(404)
  })

  it('serves stored files with nosniff and a sandbox CSP', async () => {
    const res = await upload(owner, 'image', PNG, 'x.png')
    expect(res.status).toBe(201)
    const file = await ctx.app.request(res.body.url)
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(file.headers.get('content-security-policy')).toContain('sandbox')
  })
})

describe('SVG uploads', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"'
  it.each([
    ['script', `<svg ${NS}><script>alert(1)</script></svg>`],
    ['onload', `<svg ${NS} onload="alert(1)"><rect/></svg>`],
    ['foreignObject', `<svg ${NS}><foreignObject><div>x</div></foreignObject></svg>`],
    ['xlink javascript', `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><rect/></a></svg>`],
    ['entity-encoded javascript', `<svg ${NS}><a href="&#106;avascript:alert(1)"><rect/></a></svg>`],
    ['data: URI image', `<svg ${NS}><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>`],
    ['external image', `<svg ${NS}><image href="https://evil.example/x.png"/></svg>`],
    ['unquoted external href', `<svg ${NS}><image href=https://evil.example/x.png /></svg>`],
    ['external use', `<svg ${NS}><use href="https://evil.example/a.svg#x"/></svg>`],
    ['CSS url() with scheme', `<svg ${NS}><rect style="fill:url(https://evil.example/x)"/></svg>`],
    ['CSS url() protocol-relative', `<svg ${NS}><rect style="fill:url(//evil.example/x)"/></svg>`],
    ['CSS @import string', `<svg ${NS}><style>@import "//evil.example/x.css";</style><rect/></svg>`],
    ['CSS url() in CDATA', `<svg ${NS}><style><![CDATA[ rect{fill:url(//evil.example/x)} ]]></style><rect/></svg>`],
    ['CSS url() hidden by an XML entity', `<svg ${NS}><style>rect{fill:url&#40;//evil.example/x)}</style><rect/></svg>`],
    ['set animates href', `<svg ${NS}><a><set attributeName="href" to="javascript:alert(1)"/><rect/></a></svg>`],
    ['prefixed SVG script', `<svg ${NS} xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>`],
    ['XHTML element', `<svg ${NS}><h:img xmlns:h="http://www.w3.org/1999/xhtml" src="x" /></svg>`],
    ['prefixed xlink href', `<svg ${NS} xmlns:x="http://www.w3.org/1999/xlink"><a x:href="javascript:alert(1)"><rect/></a></svg>`],
    ['entity declaration', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg ${NS}><text>&x;</text></svg>`],
    ['not well-formed XML', `<svg ${NS}><rect></svg>`],
  ])('rejects %s', async (_label, svg) => {
    const { assertCleanSvg } = await import('../lib/uploads')
    await expect(assertCleanSvg(svg)).rejects.toMatchObject({ code: 'unsafe_svg' })
  }, 20_000)

  it('accepts real-world clean SVGs, including an <?xml?> declaration and editor metadata', async () => {
    const inkscape = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="10" height="10" inkscape:version="1.3">
  <sodipodi:namedview id="n" pagecolor="#ffffff"/>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#4f46e5"/></linearGradient></defs>
  <rect width="10" height="10" fill="url(#g)"/>
</svg>`
    const res = await upload(owner, 'logo', inkscape, 'logo.svg')
    expect(res.status, res.text).toBe(201)
    expect(res.body.contentType).toBe('image/svg+xml')
    const bad = await upload(owner, 'logo', `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(//evil.example/x)"/></svg>`, 'x.svg')
    expect(bad.status).toBe(422)
  }, 20_000)
})

// ---------------------------------------------------------------------------
// Webhooks: SSRF
// ---------------------------------------------------------------------------

describe('webhook SSRF', () => {
  it.each([
    'http://localhost./x',
    'http://foo.localhost./x',
    'http://metadata.google.internal./computeMetadata',
    'http://0.0.0.0/',
    'http://[::]/',
    'http://[::1]/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f.1/',
    'http://127.1/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::127.0.0.1]/',
    'http://[fec0::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[fd00:ec2::254]/',
  ])('refuses %s', async (url) => {
    const { assertSafeUrl } = await import('../lib/webhooks')
    expect(() => assertSafeUrl(url)).toThrow()
  })

  it('checks the URL when the form is saved, not only when sending', async () => {
    const { body: form } = await editor.post('/api/forms', { title: 'Hooked' })
    for (const url of ['http://127.0.0.1:8080/hook', 'http://localhost./hook', 'http://[::ffff:10.0.0.1]/']) {
      const res = await editor.patch(`/api/forms/${form.id}`, { settings: { webhook: { enabled: true, url } } })
      expect(res.status, url).toBe(422)
      expect(res.body.error.fields['settings.webhook.url']).toBeTruthy()
    }
    const ok = await editor.patch(`/api/forms/${form.id}`, { settings: { webhook: { enabled: true, url: 'https://hooks.example.com/x' } } })
    expect(ok.status, ok.text).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Email header injection
// ---------------------------------------------------------------------------

describe('email headers', () => {
  it('strips line breaks from subjects and drops recipients that are not one plain address', async () => {
    const { normalize } = await import('../lib/email')
    const m = normalize({ to: ['ok@example.com', 'a@x.com, b@y.com', 'c@x.com\r\nBcc: d@y.com', 'Eve <e@x.com>', ''], subject: 'Hello\r\nBcc: victim@example.com', text: 'body' })
    expect(m.to).toEqual(['ok@example.com'])
    expect(m.subject).toBe('Hello Bcc: victim@example.com')
    expect(m.subject).not.toMatch(/[\r\n]/)
  })

  it('queues nothing when no recipient is valid', async () => {
    const { queueEmail } = await import('../lib/email')
    const queued = await ctx.sql.begin((tx) => queueEmail(tx, { to: 'x@y.com\nBcc: z@w.com', subject: 's', text: 't' }))
    expect(queued).toBe(false)
  })

  it('names and the app name must be one line (they end up in subjects and From)', async () => {
    const inv = await owner.post('/api/invites', { email: 'oneline@example.com', role: 'viewer' })
    const token = inv.body.link.split('/invite/')[1]
    const res = await ctx.client().post(`/api/invites/${token}/accept`, { name: 'Mallory\r\nBcc: x@evil.example', password: 'member-password-1' })
    expect(res.status).toBe(422)
    expect((await owner.patch('/api/me', { name: 'Two\nlines' })).status).toBe(422)
    expect((await owner.patch('/api/settings', { general: { appName: 'App\r\nX-Evil: 1' } })).status).toBe(422)
    expect((await owner.patch('/api/settings', { email: { fromName: 'Team\nBcc: a@b.c' } })).status).toBe(422)
  })
})

// ---------------------------------------------------------------------------
// Re-authentication brute force
// ---------------------------------------------------------------------------

describe('current-password checks', () => {
  it('are rate limited per user (a stolen session is not a password oracle)', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await viewer.patch('/api/me', { newPassword: 'another-password-1', currentPassword: `guess-${i}` })).status)
    expect(statuses.slice(0, 10).every((s) => s === 422)).toBe(true)
    expect(statuses[10]).toBe(429)
  }, 30_000)
})

// ---------------------------------------------------------------------------
// Scheduler and jobs
// ---------------------------------------------------------------------------

describe('retention', () => {
  it('keeps forms.response_count and last_response_at in step with the deleted rows', async () => {
    const form = await insertForm(ctx.sql)
    await ctx.sql`
      INSERT INTO responses (form_id, form_version_id, answers, submitted_at) VALUES
        (${form.id}, ${form.versionId}, '{}'::jsonb, now() - interval '400 days'),
        (${form.id}, ${form.versionId}, '{}'::jsonb, now() - interval '200 days'),
        (${form.id}, ${form.versionId}, '{}'::jsonb, now() - interval '1 day')
    `
    await ctx.sql`UPDATE forms SET response_count = 3, last_response_at = now() - interval '1 day' WHERE id = ${form.id}`
    expect((await owner.patch('/api/settings', { data: { retentionDays: 90 } })).status).toBe(200)
    const { applyRetention } = await import('../lib/scheduler')
    expect(await applyRetention()).toBeGreaterThanOrEqual(2)
    const [row] = await ctx.sql<{ response_count: number }[]>`SELECT response_count FROM forms WHERE id = ${form.id}`
    expect(row.response_count).toBe(1)
    await owner.patch('/api/settings', { data: { retentionDays: null } })
  }, 20_000)
})

describe('jobs', () => {
  it('a job whose worker died on its last attempt is marked failed, not left forever', async () => {
    const [job] = await ctx.sql<{ id: string }[]>`
      INSERT INTO jobs (kind, payload, max_attempts, attempts, locked_until)
      VALUES ('webhook', '{}'::jsonb, 1, 1, now() - interval '1 minute') RETURNING id
    `
    const { hourlyMaintenance } = await import('../lib/scheduler')
    const result = await hourlyMaintenance()
    expect(result.abandonedJobs).toBeGreaterThanOrEqual(1)
    const [row] = await ctx.sql<{ failed_at: Date | null; last_error: string | null }[]>`SELECT failed_at, last_error FROM jobs WHERE id = ${job.id}`
    expect(row.failed_at).not.toBeNull()
    expect(row.last_error).toMatch(/stopped/)
  })
})

describe('malformed stored close dates', () => {
  it('reopen does not 500', async () => {
    const form = await insertForm(ctx.sql, { status: 'closed', settings: { closed: true, closeAt: 'not-a-date' } })
    const res = await editor.post(`/api/forms/${form.id}/reopen`)
    expect(res.status, res.text).toBe(200)
    expect(res.body.status).toBe('live')
  })

  it('the public front page does not 500', async () => {
    await insertForm(ctx.sql, { settings: { showOnFrontPage: true, closeAt: '2026-99-99' } })
    expect((await owner.patch('/api/front-page', { enabled: true })).status).toBe(200)
    const res = await ctx.client().get('/api/public/home')
    expect(res.status, res.text).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Roles on routes this pass owns (the platform matrix lives in team.int.test.ts)
// ---------------------------------------------------------------------------

describe('roles', () => {
  it('Viewers can upload an avatar but nothing else, and never write forms, templates or the front page', async () => {
    expect((await upload(viewer, 'avatar', PNG, 'me.png')).status).toBe(201)
    expect((await upload(viewer, 'logo', PNG, 'x.png')).status).toBe(403)
    const form = await insertForm(ctx.sql)
    expect((await viewer.post(`/api/forms/${form.id}/save-as-template`, {})).status).toBe(403)
    expect((await viewer.post(`/api/forms/${form.id}/duplicate`)).status).toBe(403)
    expect((await viewer.post(`/api/forms/${form.id}/publish`)).status).toBe(403)
    expect((await viewer.post(`/api/forms/${form.id}/close`)).status).toBe(403)
    expect((await viewer.patch(`/api/front-page`, { enabled: false })).status).toBe(403)
    const saved = await editor.post(`/api/forms/${form.id}/save-as-template`, { name: 'Saved' })
    expect(saved.status).toBe(201)
    expect((await viewer.patch(`/api/templates/${saved.body.id}`, { name: 'Mine' })).status).toBe(403)
    expect((await viewer.del(`/api/templates/${saved.body.id}`)).status).toBe(403)
  }, 20_000)

  it('Editors get 403 on every Owner-only route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/settings', undefined],
      ['PATCH', '/api/settings', { general: { appName: 'Mine now' } }],
      ['GET', '/api/settings/data/export.zip', undefined],
      ['POST', '/api/invites', { email: 'x@example.com', role: 'editor' }],
      ['POST', '/api/team/transfer-ownership', { userId: owner.me!.id, currentPassword: 'x' }],
    ] as const) {
      expect((await editor.request(method, path, body)).status, `${method} ${path}`).toBe(403)
    }
  })
})
