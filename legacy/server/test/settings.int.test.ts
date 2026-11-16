import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insertForm, setupOwner, setupTestDb, type TestClient, type TestContext } from './harness'

let ctx: TestContext
let owner: TestClient
const sent: { to: string[]; subject: string }[] = []

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#4f46e5"/></svg>'
const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10"/></svg>'

beforeAll(async () => {
  ctx = await setupTestDb()
  owner = await setupOwner(ctx)
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

function upload(purpose: string, data: Buffer | string, name = 'file.bin', type = 'application/octet-stream') {
  const fd = new FormData()
  fd.append('file', new File([typeof data === 'string' ? data : new Uint8Array(data)], name, { type }))
  return owner.request('POST', `/api/uploads?purpose=${purpose}`, undefined, { raw: fd })
}

describe('settings', () => {
  it('returns defaults, and keeps general.appName from setup', async () => {
    const res = await owner.get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.general.appName).toBe('Test Forms')
    expect(res.body.spam.turnstileSecret).toEqual({ set: false })
    expect(res.body.email.smtpPass).toEqual({ set: false })
    expect(res.body.storage.driver).toBe('local')
    expect(res.body.data.retentionDays).toBeNull()
  })

  it('never returns secrets: write-only, stored encrypted', async () => {
    const secrets = { turnstileSecret: '0x4AAAAAAA-super-secret-turnstile', smtpPass: 'smtp-pass-hunter2', resendApiKey: 're_live_123456789', postmarkToken: 'pm-token-abcdef' }
    const res = await owner.patch('/api/settings', {
      spam: { turnstileSiteKey: '0x4AAAAAAA-site', turnstileSecret: secrets.turnstileSecret },
      email: { driver: 'smtp', smtpHost: 'smtp.example.com', smtpUser: 'mailer', smtpPass: secrets.smtpPass, resendApiKey: secrets.resendApiKey, postmarkToken: secrets.postmarkToken, fromAddress: 'Forms@Example.com' },
    })
    expect(res.status).toBe(200)
    const get = await owner.get('/api/settings')
    for (const text of [res.text, get.text]) for (const s of Object.values(secrets)) expect(text).not.toContain(s)
    expect(get.body.spam).toEqual({ turnstileSiteKey: '0x4AAAAAAA-site', turnstileSecret: { set: true } })
    expect(get.body.email.smtpPass).toEqual({ set: true })
    expect(get.body.email.fromAddress).toBe('forms@example.com')

    const rows = await ctx.sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key IN ('turnstile', 'email')`
    const raw = JSON.stringify(rows)
    for (const s of Object.values(secrets)) expect(raw).not.toContain(s)
    expect(raw).toMatch(/"v2\./)

    const { getTurnstileConfig } = await import('../lib/settings')
    expect((await getTurnstileConfig()).secret).toBe(secrets.turnstileSecret)
  })

  it('omitting a secret keeps it; null clears it', async () => {
    // Same host, port and user (as the settings form re-sends them): the password stays.
    await owner.patch('/api/settings', { email: { smtpHost: 'SMTP.example.com', smtpPort: 587, smtpUser: 'mailer', fromName: 'Forms' } })
    expect((await owner.get('/api/settings')).body.email.smtpPass).toEqual({ set: true })
    await owner.patch('/api/settings', { email: { smtpPass: null } })
    expect((await owner.get('/api/settings')).body.email.smtpPass).toEqual({ set: false })
  })

  it('a new SMTP host, port or user without a new password clears the stored password', async () => {
    const { getSetting, readSecret } = await import('../lib/settings')
    const setPass = async () => {
      await owner.patch('/api/settings', { email: { smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'mailer', smtpPass: 'hunter2' } })
      expect(readSecret((await getSetting('email')).smtpPass)).toBe('hunter2')
    }
    for (const change of [{ smtpHost: 'attacker.example' }, { smtpPort: 2525 }, { smtpUser: 'other' }, { smtpSecure: true, smtpPort: null }]) {
      await setPass()
      const res = await owner.patch('/api/settings', { email: change })
      expect(res.status).toBe(200)
      expect(res.body.email.smtpPass, JSON.stringify(change)).toEqual({ set: false })
      expect((await getSetting('email')).smtpPass).toBeNull()
    }
    // A new host with a new password in the same request keeps the new one.
    await setPass()
    const res = await owner.patch('/api/settings', { email: { smtpHost: 'smtp3.example.com', smtpPass: 'new-pass' } })
    expect(res.body.email.smtpPass).toEqual({ set: true })
    expect(readSecret((await getSetting('email')).smtpPass)).toBe('new-pass')
    await owner.patch('/api/settings', { email: { smtpPass: null } })
  })

  it('validates input with field errors', async () => {
    const res = await owner.patch('/api/settings', { general: { timezone: 'Mars/Olympus', appName: '' }, branding: { accentColor: 'red' }, data: { retentionDays: 0 } })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('validation_failed')
  })

  it('saves general, branding and data; /api/public/app still sees appName and logoUrl', async () => {
    const res = await owner.patch('/api/settings', {
      general: { appName: 'Renamed', logoUrl: '/api/uploads/files/intelform/logo/x.png', timezone: 'Europe/London', dateFormat: 'YYYY-MM-DD' },
      branding: { accentColor: '#112233', defaultMode: 'dark', defaultThemeId: 'midnight' },
      data: { retentionDays: 90 },
    })
    expect(res.status).toBe(200)
    expect(res.body.general).toMatchObject({ appName: 'Renamed', timezone: 'Europe/London' })
    expect(res.body.branding).toEqual({ accentColor: '#112233', defaultMode: 'dark', defaultThemeId: 'midnight' })
    expect(res.body.data.retentionDays).toBe(90)
    const { getSetting } = await import('../lib/settings')
    const general = await getSetting('general')
    expect(general.appName).toBe('Renamed')
    expect(general.logoUrl).toBe('/api/uploads/files/intelform/logo/x.png')
    await owner.patch('/api/settings', { data: { retentionDays: null } })
  })

  it('email test sends to the Owner', async () => {
    await owner.patch('/api/settings', { email: { driver: 'console' } })
    const res = await owner.post('/api/settings/email/test', {})
    expect(res.body).toMatchObject({ ok: true })
    expect(sent.at(-1)?.to).toEqual(['owner@example.com'])
  })

  it('spam test explains missing keys', async () => {
    await owner.patch('/api/settings', { spam: { turnstileSecret: null } })
    const res = await owner.post('/api/settings/spam/test', {})
    expect(res.body.ok).toBe(false)
  })

  it('storage test writes and deletes with the local driver', async () => {
    const res = await owner.post('/api/settings/storage/test', {})
    expect(res.body).toMatchObject({ ok: true })
  })

  it('exports all responses as a ZIP of CSVs', async () => {
    const form = await insertForm(ctx.sql, { slug: 'export-me' })
    await ctx.sql`INSERT INTO responses (form_id, form_version_id, answers) VALUES (${form.id}, ${form.versionId}, ${ctx.sql.json({ q1: '=cmd()' })})`
    const res = await owner.request('GET', '/api/settings/data/export.zip')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="responses-\d{4}-\d{2}-\d{2}\.zip"/)
    const raw = await ctx.app.request('/api/settings/data/export.zip', { headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
    const buf = Buffer.from(await raw.arrayBuffer())
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    expect(buf.includes(Buffer.from('export-me.csv'))).toBe(true)
  })
})

describe('uploads', () => {
  it('stores a PNG locally and serves it', async () => {
    const res = await upload('image', PNG, 'dot.jpg', 'image/jpeg')
    expect(res.status).toBe(201)
    expect(res.body.contentType).toBe('image/png') // sniffed, not the client's claim
    expect(res.body.url).toMatch(/^\/api\/uploads\/files\/intelform\/image\/[0-9a-f-]+\.png$/)
    const file = await ctx.app.request(res.body.url)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(file.headers.get('cache-control')).toMatch(/immutable/)
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('accepts a clean SVG only for logo and favicon', async () => {
    expect((await upload('logo', CLEAN_SVG, 'logo.svg', 'image/svg+xml')).status).toBe(201)
    expect((await upload('favicon', CLEAN_SVG)).status).toBe(201)
    expect((await upload('image', CLEAN_SVG)).status).toBe(415)
  }, 20_000) // the first SVG loads jsdom, which is slow on a busy machine

  it('rejects an SVG with active content', async () => {
    const res = await upload('logo', EVIL_SVG, 'evil.svg', 'image/svg+xml')
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('unsafe_svg')
    const ext = await upload('logo', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>')
    expect(ext.status).toBe(422)
  }, 20_000)

  it('rejects other types, missing files, oversize files and a bad purpose', async () => {
    expect((await upload('image', Buffer.from('%PDF-1.7 hello'), 'x.png', 'image/png')).status).toBe(415)
    expect((await upload('image', '<html><script>1</script></html>', 'x.png')).status).toBe(415)
    expect((await upload('nope', PNG)).status).toBe(422)
    expect((await owner.request('POST', '/api/uploads?purpose=image', undefined, { raw: new FormData() })).status).toBe(422)
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
    expect([413]).toContain((await upload('image', big)).status)
  })

  it('refuses path traversal when serving', async () => {
    expect((await ctx.app.request('/api/uploads/files/..%2F..%2Fetc%2Fpasswd')).status).toBe(404)
  })
})

describe('platform', () => {
  it('health and ready', async () => {
    expect((await owner.get('/api/health')).body).toEqual({ ok: true })
    expect((await owner.get('/api/ready')).body).toEqual({ ok: true, database: 'ok' })
  })

  it('API responses carry the API security headers', async () => {
    const res = await owner.get('/api/me')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('limits JSON bodies to 256 KB (A10)', async () => {
    const res = await owner.patch('/api/me', { name: 'x'.repeat(300 * 1024) })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('payload_too_large')
  })

  it('unknown API routes are JSON 404s', async () => {
    const res = await owner.get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })
})
