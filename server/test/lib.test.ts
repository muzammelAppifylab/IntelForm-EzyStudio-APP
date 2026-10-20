import './env'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret, hashIp, needsReencrypt } from '../lib/crypto'
import { CSV_BOM, contentDisposition, csvEscape, csvRow } from '../lib/csv'
import { clientIp, ipKeyFor, normalizeIp, rateLimitBucket } from '../lib/ip'
import { redactPayload } from '../lib/jobs'
import { accessLog, logger, redactPath } from '../lib/logger'
import { countryOf, deviceOf } from '../lib/request-meta'
import { assertSafeUrl, generateWebhookSecret, isPrivateAddress, readWebhookConfig, safeLookup, signWebhook } from '../lib/webhooks'
import { contentSecurityPolicy, inlineScriptHashes, surfaceFor } from '../middleware/security-headers'
import { verifyStandardWebhook } from './standard-webhooks'

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"')
    expect(csvEscape('cr\rhere')).toBe('"cr\rhere"')
  })

  it('escapes formula starts in text cells only', () => {
    expect(csvEscape('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(csvEscape('+1')).toBe("'+1")
    expect(csvEscape('-cmd')).toBe("'-cmd")
    expect(csvEscape('@here')).toBe("'@here")
    expect(csvEscape('\tTab')).toBe("'\tTab")
    expect(csvEscape('=1,2')).toBe(`"'=1,2"`)
    // Numbers stay numbers.
    expect(csvEscape(-42)).toBe('-42')
    expect(csvEscape(3.5)).toBe('3.5')
    expect(csvEscape(Number.NaN)).toBe('')
  })

  it('handles empty, boolean and date cells', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape(true)).toBe('true')
    expect(csvEscape(new Date('2026-10-19T10:00:00Z'))).toBe('2026-10-19T10:00:00.000Z')
  })

  it('rows end in CRLF and the BOM is U+FEFF', () => {
    expect(csvRow(['a', 1, null, 'x,y'])).toBe('a,1,,"x,y"\r\n')
    expect(CSV_BOM).toBe('﻿')
    expect(contentDisposition('Ünïcode "form".csv')).toBe(`attachment; filename="_n_code _form_.csv"; filename*=UTF-8''%C3%9Cn%C3%AFcode%20%22form%22.csv`)
  })
})

describe('webhook signing', () => {
  it('produces signatures the standardwebhooks algorithm accepts', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/)
    const body = JSON.stringify({ hello: 'world', n: 1 })
    const ts = Math.floor(Date.now() / 1000)
    const sig = signWebhook(secret, 'msg_abc', ts, body)
    expect(sig).toMatch(/^v1,[A-Za-z0-9+/]+=*$/)
    const headers = { 'webhook-id': 'msg_abc', 'webhook-timestamp': String(ts), 'webhook-signature': sig }
    expect(verifyStandardWebhook(secret, headers, body)).toEqual({ hello: 'world', n: 1 })
    // Several space-separated signatures (rotation) still verify.
    expect(verifyStandardWebhook(secret, { ...headers, 'webhook-signature': `v1,AAAA ${sig}` }, body)).toBeTruthy()
  })

  it('matches the spec test vector', () => {
    // From the Standard Webhooks reference implementations.
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
    const sig = signWebhook(secret, 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}')
    expect(sig).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=')
  })

  it('rejects tampered bodies, ids and stale timestamps', () => {
    const secret = generateWebhookSecret()
    const ts = Math.floor(Date.now() / 1000)
    const sig = signWebhook(secret, 'msg_1', ts, '{"a":1}')
    const h = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sig }
    expect(() => verifyStandardWebhook(secret, h, '{"a":2}')).toThrow()
    expect(() => verifyStandardWebhook(secret, { ...h, 'webhook-id': 'msg_2' }, '{"a":1}')).toThrow()
    expect(() => verifyStandardWebhook(generateWebhookSecret(), h, '{"a":1}')).toThrow()
    const old = ts - 600
    expect(() =>
      verifyStandardWebhook(secret, { ...h, 'webhook-timestamp': String(old), 'webhook-signature': signWebhook(secret, 'msg_1', old, '{"a":1}') }, '{"a":1}'),
    ).toThrow(/too old/)
  })

  it('reads form webhook config and drops reserved or unsafe headers', () => {
    const cfg = readWebhookConfig({
      webhook: { url: ' https://hooks.example.com/x ', headers: [{ key: 'Authorization', value: 'Bearer 1' }, { key: 'Host', value: 'x' }, { key: 'webhook-id', value: 'x' }, { key: 'X-Bad', value: 'a\r\nb' }, { key: 'bad key', value: 'x' }] },
    })
    expect(cfg).toEqual({ enabled: true, url: 'https://hooks.example.com/x', headers: [['Authorization', 'Bearer 1']] })
    expect(readWebhookConfig({ webhook: { url: 'https://x.example', enabled: false } }).enabled).toBe(false)
    expect(readWebhookConfig({}).enabled).toBe(false)
    expect(readWebhookConfig({ webhook: { url: 'https://x.example', headers: { 'X-One': '1' } } }).headers).toEqual([['X-One', '1']])
  })
})

describe('SSRF checks', () => {
  it.each([
    '127.0.0.1', '127.255.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '198.18.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true))

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  )

  it('validates URLs before sending', () => {
    expect(assertSafeUrl('https://hooks.example.com/x').hostname).toBe('hooks.example.com')
    for (const bad of ['ftp://x.example', 'file:///etc/passwd', 'not a url', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://localhost:8080', 'http://db.internal/', 'https://user:pw@x.example/']) {
      expect(() => assertSafeUrl(bad), bad).toThrow()
    }
  })

  it('the socket lookup refuses names that resolve to private addresses', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => safeLookup('localhost', { all: true }, (e) => resolve(e)))
    expect(err?.code).toBe('EPRIVATEADDR')
  })
})

describe('secrets', () => {
  it('round-trips in the v2 format', () => {
    const enc = encryptSecret('s3cret')
    expect(enc).toMatch(/^v2\.[\w-]{8}\./)
    expect(decryptSecret(enc)).toBe('s3cret')
    expect(needsReencrypt(enc)).toBe(false)
    expect(encryptSecret('s3cret')).not.toBe(enc)
  })

  it('still reads the v1 format', async () => {
    const { createCipheriv, createHash, randomBytes } = await import('node:crypto')
    const key = createHash('sha256').update(`intelform:secrets:${process.env.APP_SECRET}`).digest()
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([c.update('legacy', 'utf8'), c.final()])
    const v1 = ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
    expect(decryptSecret(v1)).toBe('legacy')
    expect(needsReencrypt(v1)).toBe(true)
  })

  it('rejects tampering', () => {
    const enc = encryptSecret('value')
    const parts = enc.split('.')
    parts[4] = Buffer.from('other').toString('base64url')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
    expect(() => decryptSecret('garbage')).toThrow()
  })
})

describe('client IP', () => {
  async function ipFor(headers: Record<string, string>, hops: number, socket = '10.0.0.5') {
    const app = new Hono().get('/', (c) => c.text(clientIp(c, hops) ?? 'null'))
    const res = await app.request('/', { headers }, { incoming: { socket: { remoteAddress: socket } } })
    return res.text()
  }

  it('uses the socket and ignores X-Forwarded-For with no trusted proxy', async () => {
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6' }, 0, '203.0.113.9')).toBe('203.0.113.9')
  })

  it('takes the entry N hops from the right', async () => {
    // Client spoofs 6.6.6.6; the one trusted proxy appended the real client 198.51.100.7.
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }, 1)).toBe('198.51.100.7')
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.2' }, 2)).toBe('198.51.100.7')
  })

  it('falls back to the socket, never a client-written entry, when the chain is short', async () => {
    // Two proxies configured, but the request reached the app directly with a forged header.
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6' }, 2, '203.0.113.9')).toBe('203.0.113.9')
    expect(await ipFor({}, 1, '203.0.113.9')).toBe('203.0.113.9')
    expect(await ipFor({ 'x-forwarded-for': '' }, 1, '203.0.113.9')).toBe('203.0.113.9')
    expect(await ipFor({ 'x-forwarded-for': ' , ,' }, 1, '203.0.113.9')).toBe('203.0.113.9')
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, 5, '203.0.113.9')).toBe('203.0.113.9')
  })

  it('falls back to the socket when the trusted entry is not an IP', async () => {
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6, unknown' }, 1, '10.0.0.5')).toBe('10.0.0.5')
    expect(await ipFor({ 'x-forwarded-for': '<script>, 999.1.1.1' }, 1, '10.0.0.5')).toBe('10.0.0.5')
    // Garbage further left (client-written) doesn't matter.
    expect(await ipFor({ 'x-forwarded-for': 'garbage, 198.51.100.7' }, 1)).toBe('198.51.100.7')
    expect(await ipFor({ 'x-forwarded-for': '198.51.100.7:4711' }, 1)).toBe('198.51.100.7')
  })

  it('normalizes addresses', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4')
    expect(normalizeIp('1.2.3.4:5678')).toBe('1.2.3.4')
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1')
    expect(normalizeIp('nonsense')).toBeNull()
  })

  it('buckets IPv6 by /64 for rate limits, expanding compressed forms first', () => {
    expect(rateLimitBucket('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(rateLimitBucket('2001:db8:0:0:ffff:ffff:ffff:ffff')).toBe('2001:db8:0:0::/64')
    expect(rateLimitBucket('2001:0DB8:0000:0001:0000:0000:0000:0001')).toBe('2001:db8:0:1::/64')
    expect(rateLimitBucket('2001:db8:0:1::')).toBe('2001:db8:0:1::/64')
    expect(rateLimitBucket('2001:db8:aa:bb:cc::')).toBe('2001:db8:aa:bb::/64')
    expect(rateLimitBucket('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitBucket('::')).toBe('0:0:0:0::/64')
    expect(rateLimitBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(rateLimitBucket('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64')
    // IPv4, and IPv4-mapped in either spelling, stay per address.
    expect(rateLimitBucket('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitBucket('::ffff:102:304')).toBe('1.2.3.4')
    expect(rateLimitBucket(normalizeIp('::ffff:1.2.3.4')!)).toBe('1.2.3.4')
  })

  it('gives every address in a /64 the same rate-limit key', () => {
    expect(ipKeyFor('2001:db8:1:2::1')).toBe(ipKeyFor('2001:db8:1:2:dead:beef:0:42'))
    expect(ipKeyFor('2001:db8:1:2::1')).toBe(hashIp('2001:db8:1:2::/64'))
    expect(ipKeyFor('2001:db8:1:2::1')).not.toBe(ipKeyFor('2001:db8:1:3::1'))
    expect(ipKeyFor('203.0.113.9')).toBe(hashIp('203.0.113.9'))
    expect(ipKeyFor('203.0.113.9')).not.toBe(ipKeyFor('203.0.113.10'))
  })
})

describe('log redaction', () => {
  it('cuts invite tokens and upload file names from paths', () => {
    expect(redactPath('/api/invites/abcDEF_123-xyz')).toBe('/api/invites/[redacted]')
    expect(redactPath('/api/invites/abcDEF_123-xyz/accept')).toBe('/api/invites/[redacted]/accept')
    // Invite ids are not secret.
    expect(redactPath('/api/invites/3f2b8c1e-1d2a-4b5c-9d8e-7f6a5b4c3d2e')).toBe('/api/invites/3f2b8c1e-1d2a-4b5c-9d8e-7f6a5b4c3d2e')
    expect(redactPath('/api/invites')).toBe('/api/invites')
    expect(redactPath('/api/uploads/files/intelform/signature/9b1d.png')).toBe('/api/uploads/files/intelform/signature/[redacted]')
    expect(redactPath('/api/forms/abc/responses')).toBe('/api/forms/abc/responses')
  })

  it('the access log line for an invite never holds the token', async () => {
    const token = 'Zx9_live-invite-token-0123456789abcdefghijk'
    const app = new Hono()
      .use(accessLog)
      .get('/api/invites/:token', (c) => c.json({ ok: true }))
      .post('/api/invites/:token/accept', (c) => c.json({ ok: true }, 201))
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    try {
      await app.request(`/api/invites/${token}`)
      await app.request(`/api/invites/${token}/accept`, { method: 'POST' })
      const lines = info.mock.calls.map((call) => JSON.stringify(call))
      expect(lines).toHaveLength(2)
      for (const line of lines) expect(line).not.toContain(token)
      expect(lines[1]).toContain('/api/invites/[redacted]/accept')
    } finally {
      info.mockRestore()
    }
  })

  it('finished job payloads keep only the form and response ids', () => {
    expect(redactPayload({ to: ['a@example.com'], text: 'https://x/reset/tok' })).toEqual({ redacted: true })
    expect(redactPayload({ formId: 'f', responseId: 'r', payload: { answers: { q: 'secret' } } })).toEqual({ redacted: true, formId: 'f', responseId: 'r' })
    expect(redactPayload({ formId: { nested: 'secret' } })).toEqual({ redacted: true })
    expect(redactPayload(null)).toEqual({ redacted: true })
    expect(redactPayload(['x'])).toEqual({ redacted: true })
  })
})

describe('request meta', () => {
  async function countryFor(headers: Record<string, string>, header: string | undefined) {
    const app = new Hono().get('/', (c) => c.text(countryOf(c, header) ?? 'null'))
    return (await app.request('/', { headers })).text()
  }

  it('reads a country only from the configured header, as a two-letter code', async () => {
    // Unset: CF-IPCountry is client-controlled without Cloudflare, so it's ignored.
    expect(await countryFor({ 'cf-ipcountry': 'DE' }, undefined)).toBe('null')
    expect(await countryFor({ 'cf-ipcountry': 'de' }, 'CF-IPCountry')).toBe('DE')
    expect(await countryFor({ 'x-country': ' fr ' }, 'X-Country')).toBe('FR')
    expect(await countryFor({ 'cf-ipcountry': 'DE' }, 'X-Country')).toBe('null')
    for (const bad of ['XX', 'T1', 'DEU', 'D', '1A', '<b>', '']) expect(await countryFor({ 'x-country': bad }, 'X-Country')).toBe('null')
  })

  it('detects device and browser, preferring client hints', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    expect(deviceOf(iphone)).toEqual({ device: 'mobile', browser: 'Safari' })
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    expect(deviceOf(chrome)).toEqual({ device: 'desktop', browser: 'Chrome' })
    expect(deviceOf(chrome, { mobile: '?1', brands: '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99"' })).toEqual({ device: 'mobile', browser: 'Edge' })
    expect(deviceOf('')).toEqual({ device: null, browser: null })
  })
})

describe('security headers', () => {
  it('hashes inline scripts only', () => {
    const html = '<script>console.log(1)</script><script type="module" src="/x.js"></script><script>  </script>'
    expect(inlineScriptHashes(html)).toEqual(["'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='"])
  })

  it('frames forms anywhere and the dashboard nowhere', () => {
    expect(contentSecurityPolicy('form')).toContain('frame-ancestors *')
    expect(contentSecurityPolicy('form')).toContain('https://challenges.cloudflare.com')
    expect(contentSecurityPolicy('dashboard')).toContain("frame-ancestors 'none'")
    expect(contentSecurityPolicy('dashboard')).not.toContain('challenges.cloudflare.com')
    expect(surfaceFor('/f/abc')).toBe('form')
    expect(surfaceFor('/embed.js')).toBe('form')
    expect(surfaceFor('/dashboard')).toBe('dashboard')
    expect(surfaceFor('/fancy')).toBe('dashboard')
  })

  it('allows only self-hosted styles and fonts (no third-party font CDN)', () => {
    for (const surface of ['form', 'dashboard'] as const) {
      const csp = contentSecurityPolicy(surface)
      expect(csp).toContain("style-src 'self' 'unsafe-inline';")
      expect(csp).toContain("font-src 'self' data:;")
      expect(csp).not.toMatch(/googleapis|gstatic/)
    }
  })
})

describe('webhook test payload', () => {
  it('has the same keys and answer shapes as a real delivery', async () => {
    const { formDefinition } = await import('../../shared/form/definition')
    const { testPayload } = await import('../routes/builder/index')
    const { webhookPayload } = await import('../respondent/notify')
    const def = formDefinition.parse({
      layout: 'all_at_once',
      startScreen: { enabled: false, title: '', button: 'Start' },
      endScreen: { title: 'Thanks', message: '' },
      labels: {},
      fields: [
        { id: 'f_pick', type: 'single_choice', label: 'Pick one', props: { options: [{ id: 'o_aa', label: 'A' }] } },
        { id: 'f_many', type: 'multiple_choice', label: 'Pick some', props: { options: [{ id: 'o_bb', label: 'B' }] } },
      ],
    })
    const sample = testPayload({ id: 'form-1', title: 'Survey', version: 3 }, def)
    const real = webhookPayload(
      { id: 'form-1', title: 'Survey' } as Parameters<typeof webhookPayload>[0],
      def,
      { id: 'r-1', submittedAt: new Date(), versionId: 'v-1', version: 3, answers: { f_pick: { option: 'o_aa' }, f_many: [{ option: 'o_bb' }] } },
    )
    const { test: _test, ...sampleRest } = sample
    expect(Object.keys(sampleRest).sort()).toEqual(Object.keys(real).sort())
    expect(sample.form_version).toBe(3)
    expect(sample.answers).toEqual(real.answers)
  })
})
