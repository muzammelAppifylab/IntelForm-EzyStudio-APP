import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  assertSafeUrl,
  deliverWebhook,
  generateWebhookSecret,
  HTTPS_REQUIRED,
  isPrivateAddress,
  describeError,
  readCapped,
  readWebhookConfig,
  retryableStatus,
  sampleWebhookPayload,
  signWebhook,
  webhookPayload,
  WebhookError,
  WebhookUrlError,
} from '../../src/server/intelform/webhooks'
import { parseIPv6 } from '../../src/server/intelform/webhooks/ssrf'
import { blankDefinition, newField, type FormDefinition } from '../../src/lib/intelform/form/definition'

const LIVE = { allowHttp: false, allowPrivate: false }
/** A secret made at run time: no key-shaped literal in the code. */
const SECRET = generateWebhookSecret()
/** The Standard Webhooks spec vector's raw key (the `whsec_` prefix is optional for signWebhook). */
const SPEC_KEY = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'

/** The Standard Webhooks verification, done independently with node:crypto. */
function verify(secret: string, id: string, ts: number, body: string, header: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return header.split(' ').some((s) => s === `v1,${expected}`)
}

describe('webhook signing', () => {
  it('makes whsec_ secrets of 32 random bytes', () => {
    const a = generateWebhookSecret()
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/)
    expect(generateWebhookSecret()).not.toBe(a)
  })

  it('signs what the standardwebhooks algorithm accepts', async () => {
    const secret = generateWebhookSecret()
    const body = JSON.stringify({ hello: 'world', n: 1 })
    const ts = Math.floor(Date.now() / 1000)
    const sig = await signWebhook(secret, 'msg_abc', ts, body)
    expect(sig).toMatch(/^v1,[A-Za-z0-9+/]+=*$/)
    expect(verify(secret, 'msg_abc', ts, body, sig)).toBe(true)
    expect(verify(secret, 'msg_abc', ts, '{"other":1}', sig)).toBe(false)
  })

  it('matches the spec test vector', async () => {
    const sig = await signWebhook(SPEC_KEY, 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}')
    expect(sig).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=')
  })
})

describe('webhook config', () => {
  it('reads the url and safe custom headers only', () => {
    const cfg = readWebhookConfig({
      webhook: {
        enabled: true,
        url: ' https://hooks.example.com/x ',
        headers: [
          { key: 'Authorization', value: 'Bearer 1' },
          { key: 'Host', value: 'x' },
          { key: 'webhook-id', value: 'x' },
          { key: 'X-Bad', value: 'a\r\nb' },
          { key: 'bad key', value: 'x' },
          { key: 'Cookie', value: 'a=b' },
        ],
      },
    })
    expect(cfg).toEqual({ enabled: true, url: 'https://hooks.example.com/x', headers: [['Authorization', 'Bearer 1']] })
    expect(readWebhookConfig({ webhook: { url: 'https://x.example', enabled: false } }).enabled).toBe(false)
    expect(readWebhookConfig({}).enabled).toBe(false)
    expect(readWebhookConfig(null).enabled).toBe(false)
    expect(readWebhookConfig({ webhook: { enabled: true, url: null } }).enabled).toBe(false)
    expect(readWebhookConfig({ webhook: { url: 'https://x.example', headers: { 'X-One': '1' } } }).headers).toEqual([['X-One', '1']])
  })
})

describe('SSRF checks', () => {
  it.each([
    '127.0.0.1', '127.255.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '198.18.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::1', '[::1]', 'not-an-ip', '1.2.3', '1.2.3.256',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true))

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'])(
    'allows %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  )

  it('expands IPv6 forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304])
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(parseIPv6('1::2::3')).toBeNull()
    expect(parseIPv6('12345::')).toBeNull()
  })

  it('validates URLs before saving and sending', () => {
    expect(assertSafeUrl('https://hooks.example.com/x', LIVE).hostname).toBe('hooks.example.com')
    for (const bad of [
      'ftp://x.example',
      'file:///tmp/x',
      'not a url',
      '',
      'https://127.0.0.1/',
      'https://2130706433/',
      'https://0x7f.1/',
      'https://[::1]/',
      'https://[::ffff:169.254.169.254]/',
      'https://169.254.169.254/latest',
      'https://localhost:8080',
      'https://localhost./',
      'https://db.internal/',
      'https://printer.local/',
      'https://intranet/',
      'https://user:pw@x.example/',
    ]) {
      expect(() => assertSafeUrl(bad, LIVE), bad).toThrow(WebhookUrlError)
    }
  })

  it('needs https on the live site, allows http and local targets off it', () => {
    expect(() => assertSafeUrl('http://hooks.example.com/x', LIVE)).toThrow(HTTPS_REQUIRED)
    expect(assertSafeUrl('http://hooks.example.com/x', { allowHttp: true, allowPrivate: false }).protocol).toBe('http:')
    expect(assertSafeUrl('http://localhost:4000/hook', { allowHttp: true, allowPrivate: true }).port).toBe('4000')
  })
})

function defWith(fields: FormDefinition['fields']): FormDefinition {
  return { ...blankDefinition(), fields }
}

describe('webhook payload', () => {
  const email = { ...newField('email'), id: 'f_email1', label: 'Email' }
  const sig = { ...newField('signature'), id: 'f_sign01', label: 'Sign here' }
  const name = { ...newField('short_text'), id: 'f_name01', label: 'Hi {f_email1}' }
  const def = defWith([email, sig, name] as FormDefinition['fields'])

  it('keys answers by field id with label and type, signatures as the guarded view link', () => {
    const p = webhookPayload(
      { id: 'form-1', title: 'Contact' },
      def,
      {
        id: 'resp-1',
        submittedAt: new Date('2026-01-02T03:04:05.000Z'),
        version: 3,
        answers: { f_email1: 'ada@example.com', f_sign01: { fileId: 'file_0123456789abcdefghijklmnop' }, f_name01: 'Ada' },
      },
      'https://forms.example.com',
    )
    expect(p).toEqual({
      type: 'response.created',
      form_id: 'form-1',
      form_title: 'Contact',
      form_version: 3,
      response_id: 'resp-1',
      submitted_at: '2026-01-02T03:04:05.000Z',
      answers: {
        f_email1: { label: 'Email', type: 'email', value: 'ada@example.com' },
        // The file is private: the link is the dashboard's guarded view route, never a storage link.
        f_sign01: { label: 'Sign here', type: 'signature', value: { url: 'https://forms.example.com/site-api/uploads/signatures/resp-1/f_sign01' } },
        f_name01: { label: 'Hi ada@example.com', type: 'short_text', value: 'Ada' },
      },
    })
  })

  it('sends sample answers for a test', () => {
    const p = sampleWebhookPayload({ id: 'form-1', title: 'Contact', version: null }, def)
    expect(p.type).toBe('response.test')
    expect(p.test).toBe(true)
    expect(p.response_id).toBeNull()
    expect(Object.keys(p.answers)).toEqual(['f_email1', 'f_sign01', 'f_name01'])
    expect(p.answers.f_email1.value).toBe('sam@example.com')
  })
})

// ---------------------------------------------------------------------------
// Delivery of real responses, with a stand-in database and fetch
// ---------------------------------------------------------------------------

interface LogRow {
  values: unknown[]
}

function fakeDb(settings: unknown, opts: { secret?: string | null } = {}) {
  const logs: LogRow[] = []
  let secret = opts.secret === undefined ? SECRET : opts.secret
  const secretQueries: unknown[][] = []
  const db = {
    form: {
      findUnique: vi.fn(async () => ({ settings, webhookSecret: secret })),
    },
    $queryRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      if (s.join('?').includes('webhook_secret = COALESCE')) {
        secretQueries.push(values)
        secret ??= values[0] as string
        return [{ secret }]
      }
      logs.push({ values })
      return [{ id: `d${logs.length}` }]
    }),
  }
  return { db: db as never, logs, raw: db, secretQueries }
}

const ON = { webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [{ key: 'X-Token', value: 't' }] } }

describe('deliverWebhook', () => {
  it('posts a signed body with the custom headers and logs it', async () => {
    const { db, logs } = fakeDb(ON)
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('thanks', { status: 200 }))
    const r = await deliverWebhook(db, 'form-1', { a: 1 }, { responseId: 'resp-1', fetchImpl: fetchImpl as never })
    expect(r).toMatchObject({ ok: true, retryable: false, statusCode: 200, error: null, webhookId: 'msg_resp-1', deliveryId: 'd1' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://hooks.example.com/in')
    expect(init?.redirect).toBe('manual')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const h = init?.headers as Record<string, string>
    expect(h['x-token'] ?? h['X-Token']).toBe('t')
    expect(h['content-type']).toBe('application/json')
    expect(h['user-agent']).toBe('IntelForm-Webhooks/1')
    expect(verify(SECRET, 'msg_resp-1', Number(h['webhook-timestamp']), String(init?.body), h['webhook-signature'])).toBe(
      true,
    )
    expect(logs).toHaveLength(1)
    // response id, url, status, …, body captured
    expect(logs[0].values).toContain('thanks')
    expect(logs[0].values).toContain('https://hooks.example.com/in')
  })

  it('marks 5xx, 429 and network errors retryable, 4xx and redirects not', async () => {
    const cases: [() => Promise<Response>, boolean, RegExp][] = [
      [async () => new Response('x', { status: 503 }), true, /answered 503/],
      [async () => new Response('x', { status: 429 }), true, /answered 429/],
      [async () => new Response('x', { status: 404 }), false, /answered 404/],
      [async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } }), false, /Redirects/],
      [
        async () => {
          throw Object.assign(new Error('x'), { name: 'TimeoutError' })
        },
        true,
        /Timed out/,
      ],
      [
        async () => {
          throw new TypeError('fetch failed')
        },
        true,
        /could not be reached/,
      ],
    ]
    for (const [impl, retryable, error] of cases) {
      const { db } = fakeDb(ON)
      const r = await deliverWebhook(db, 'form-1', {}, { responseId: 'resp-1', fetchImpl: impl as never })
      expect(r.ok).toBe(false)
      expect(r.retryable).toBe(retryable)
      expect(r.error).toMatch(error)
    }
    expect(retryableStatus(500)).toBe(true)
    expect(retryableStatus(400)).toBe(false)
  })

  it('refuses a private target before any request, and logs it', async () => {
    const { db, logs } = fakeDb({ webhook: { enabled: true, url: 'ftp://hooks.example.com/in', headers: [] } })
    const fetchImpl = vi.fn()
    const r = await deliverWebhook(db, 'form-1', {}, { responseId: 'resp-1', fetchImpl: fetchImpl as never })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r).toMatchObject({ ok: false, retryable: false })
    expect(logs).toHaveLength(1)
  })

  it('throws WebhookError when off, removed or gone, before any request', async () => {
    const fetchImpl = vi.fn()
    const off = fakeDb({ webhook: { enabled: false, url: 'https://hooks.example.com/in', headers: [] } })
    await expect(deliverWebhook(off.db, 'form-1', {}, { responseId: 'r', fetchImpl: fetchImpl as never })).rejects.toMatchObject({
      code: 'webhook_disabled',
      status: 422,
    })
    const removed = fakeDb({ webhook: { enabled: false, url: null, headers: [] } }, { secret: null })
    await expect(deliverWebhook(removed.db, 'form-1', {}, { responseId: 'r', fetchImpl: fetchImpl as never })).rejects.toBeInstanceOf(
      WebhookError,
    )
    expect(removed.secretQueries).toHaveLength(0)
    const gone = fakeDb({})
    ;(gone.raw.form.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    await expect(deliverWebhook(gone.db, 'form-1', {}, { responseId: 'r' })).rejects.toMatchObject({ status: 404 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('creates the secret on first use, in one statement', async () => {
    const { db, secretQueries } = fakeDb(ON, { secret: null })
    const ok = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('', { status: 200 }))
    await deliverWebhook(db, 'form-1', {}, { responseId: 'resp-1', fetchImpl: ok as never })
    expect(secretQueries).toHaveLength(1)
    const made = secretQueries[0][0] as string
    expect(made).toMatch(/^whsec_/)
    const init = ok.mock.calls[0][1]
    const h = init?.headers as Record<string, string>
    expect(verify(made, 'msg_resp-1', Number(h['webhook-timestamp']), String(init?.body), h['webhook-signature'])).toBe(true)
  })
})

describe('describeError', () => {
  it('puts network failures in words, never a stack', () => {
    expect(describeError(new WebhookUrlError('Use an https:// address'))).toBe('Use an https:// address')
    expect(describeError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('Timed out after 10 seconds')
    expect(describeError(new Error('403 Egress blocked'))).toBe('Webhooks can’t be sent to that address')
    expect(describeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe(
      'The host name could not be found',
    )
    expect(describeError(new Error('getaddrinfo EAI_AGAIN x'))).toBe('The host name could not be found')
    expect(describeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(
      'The connection was refused',
    )
    expect(describeError(null)).toBe('The endpoint could not be reached')
  })
})

describe('readCapped', () => {
  it('keeps the first KB only', async () => {
    const text = await readCapped(new Response('x'.repeat(5000)))
    expect(text).toHaveLength(1024)
    expect(await readCapped(new Response(null, { status: 204 }))).toBe('')
  })
})
