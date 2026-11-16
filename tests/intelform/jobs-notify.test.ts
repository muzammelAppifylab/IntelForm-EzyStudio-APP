import { describe, expect, it, vi } from 'vitest'
import { blankDefinition, newField, type FormDefinition } from '../../src/lib/intelform/form/definition'
import { defaultFormSettings } from '../../src/lib/intelform/form/settings'
import { DontRetry, JobRejected } from '../../src/platform/background'
import { generateWebhookSecret } from '../../src/server/intelform/webhooks/sign'
import {
  answersAsText,
  CONFIRM_EMAIL_LIMIT,
  formatFrom,
  MailError,
  mailProvider,
  normalizeMessage,
  NOTIFY_LIST,
  queueResponseJobs,
  readNotifySettings,
  responseNeedsJobs,
  responsePath,
  runResponseNotify,
  runWebhookDelivery,
  stripLinks,
  WEBHOOK_LIST,
  withoutLinks,
  type MailMessage,
  type MailProvider,
} from '../../src/server/intelform/notify'
import { postmarkProvider, resendProvider } from '../../src/server/intelform/notify/mailer'

// ---------------------------------------------------------------------------
// Link stripping (legacy lib.test.ts cases)
// ---------------------------------------------------------------------------

describe('confirmation email link stripping', () => {
  it('removes URLs, bare domains, IPs and link schemes from answers', () => {
    const cases: [string, string][] = [
      ['Go to www.evil.com/login now', 'Go to now'],
      ['Log in at evil.com/x please', 'Log in at please'],
      ['Visit EVIL.COM.', 'Visit .'],
      ['see http://evil.example/claim now', 'see now'],
      ['hxxp://evil.example and ftp://x', 'and'],
      ['ip 192.168.1.10/admin and [::1]:8080/x', 'ip and'],
      ['write mailto:bad@evil.com or tel:+15551234', 'write or'],
      ['javascript:alert(1)', ''],
      [`evil${String.fromCharCode(0x200b)}.com/x`, ''],
      [`evil${String.fromCharCode(0x3002)}com/x`, ''],
      ['xn--80ak6aa92e.com', ''],
      ['пример.рф/путь', ''],
      ['sub.evil.co.uk:8443/path?q=1#x', ''],
      ['ada@evil.com/login', 'ada@'],
    ]
    for (const [input, out] of cases) expect(stripLinks(input), input).toBe(out)
  })

  it('keeps normal sentences and plain email addresses', () => {
    for (const text of [
      'I love it. Really, e.g. this and i.e. that. Score 3.5 out of 5, version 1.2.',
      'Hotel: Hilton. Tel: 555-1234. Note:nothing',
      'Mr. Smith, Dr. Who and St. Ives… ok?',
      'Reply to ada@example.com.',
      'ada.lovelace+forms@mail.example.org',
    ]) {
      expect(stripLinks(text), text).toBe(text)
    }
    expect(withoutLinks({ a: ['x evil.com y'], b: { first: 'Ada www.x.io' }, n: 3 })).toEqual({ a: ['x y'], b: { first: 'Ada' }, n: 3 })
  })
})

// ---------------------------------------------------------------------------
// Mail provider
// ---------------------------------------------------------------------------

describe('mail messages', () => {
  it('drops anything but one plain recipient and cleans the subject', () => {
    expect(normalizeMessage({ to: 'a@x.com, b@y.com', subject: 's', text: 't' })).toBeNull()
    expect(normalizeMessage({ to: 'a@x.com\r\nBcc: b@y.com', subject: 's', text: 't' })).toBeNull()
    expect(normalizeMessage({ to: '"Ada" <a@x.com>', subject: 's', text: 't' })).toBeNull()
    const m = normalizeMessage({ to: ' a@x.com ', subject: `Hi\r\nBcc: x${String.fromCharCode(0x2028)}y`, text: 't', replyTo: 'bad reply' })
    expect(m).toEqual({ to: 'a@x.com', subject: 'Hi Bcc: x y', text: 't', replyTo: null })
  })

  it('formats the sender', () => {
    expect(formatFrom('Acme "Forms"', 'no-reply@acme.test')).toBe('"Acme Forms" <no-reply@acme.test>')
    expect(formatFrom(null, 'no-reply@acme.test')).toBe('no-reply@acme.test')
  })

  it('picks the provider from the owner secrets, none without a sender', () => {
    const secrets = (map: Record<string, string>) => (n: string) => map[n] ?? null
    expect(mailProvider('Acme', secrets({ RESEND_API_KEY: 're_x' }))).toBeNull()
    expect(mailProvider('Acme', secrets({ RESEND_API_KEY: 're_x', EMAIL_FROM_ADDRESS: 'forms@acme.test' }))?.name).toBe('resend')
    expect(mailProvider('Acme', secrets({ POSTMARK_SERVER_TOKEN: 'pm', EMAIL_FROM_ADDRESS: 'forms@acme.test' }))?.from).toBe('"Acme" <forms@acme.test>')
    expect(mailProvider('Acme', secrets({ EMAIL_FROM_ADDRESS: 'forms@acme.test' }))).toBeNull()
  })

  it('calls Resend with the key, an idempotency key and one recipient', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response('{"id":"1"}', { status: 200 }))
    await resendProvider('re_key', 'f@acme.test', fetchImpl as never).send({ to: 'a@x.com', subject: 's', text: 't', replyTo: 'r@acme.test' }, { idempotencyKey: 'k1' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer re_key')
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('k1')
    expect(JSON.parse(String(init?.body))).toEqual({ from: 'f@acme.test', to: ['a@x.com'], subject: 's', text: 't', reply_to: 'r@acme.test' })
  })

  it('says whether a provider failure is worth retrying', async () => {
    const p500 = postmarkProvider('t', 'f@acme.test', (async () => new Response('{"Message":"down"}', { status: 500 })) as never)
    await expect(p500.send({ to: 'a@x.com', subject: 's', text: 't' })).rejects.toMatchObject({ retryable: true })
    const p422 = postmarkProvider('t', 'f@acme.test', (async () => new Response('{"Message":"bad"}', { status: 422 })) as never)
    await expect(p422.send({ to: 'a@x.com', subject: 's', text: 't' })).rejects.toMatchObject({ retryable: false })
    const net = resendProvider('k', 'f@acme.test', (async () => {
      throw new TypeError('fetch failed')
    }) as never)
    await expect(net.send({ to: 'a@x.com', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailError)
  })
})

// ---------------------------------------------------------------------------
// Sending the job
// ---------------------------------------------------------------------------

describe('queueResponseJobs', () => {
  const R = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('sends one keyed job when something is on, none otherwise', async () => {
    const send = vi.fn(async () => ({ id: 'j', list: NOTIFY_LIST, runAt: '', deduplicated: false, local: true }))
    expect(responseNeedsJobs(defaultFormSettings())).toBe(false)
    expect(await queueResponseJobs('https://x.test/', { formId: 'f', formTitle: 'T', responseId: R, settings: defaultFormSettings() }, send)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    const on = { ...defaultFormSettings(), notifyOnResponse: true }
    expect(await queueResponseJobs('https://x.test/', { formId: 'f', formTitle: 'Contact', responseId: R, settings: on }, send)).toBe(true)
    expect(send).toHaveBeenCalledWith('https://x.test/', NOTIFY_LIST, { responseId: R }, { key: `notify-${R}`, label: 'New response · Contact' })
    expect(responseNeedsJobs({ webhook: { enabled: true, url: 'https://h.example/x', headers: [] } })).toBe(true)
    expect(responseNeedsJobs({ confirmationEmail: true, confirmationEmailFieldId: 'f_x' })).toBe(true)
  })

  it('never throws when the platform refuses', async () => {
    const send = vi.fn(async () => {
      throw new JobRejected('limit', 'E_JOBS_RATE_LIMITED', 429)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const on = { ...defaultFormSettings(), notifyOnResponse: true }
    expect(await queueResponseJobs('https://x.test/', { formId: 'f', formTitle: 'T', responseId: R, settings: on }, send as never)).toBe(false)
    expect(warn.mock.calls[0][0]).not.toContain('@')
    warn.mockRestore()
  })
})

describe('notify settings', () => {
  it('reads stored settings leniently', () => {
    expect(readNotifySettings(null)).toMatchObject({ notifyOnResponse: false, notifyRecipients: [], confirmationEmail: false })
    expect(readNotifySettings({ notifyOnResponse: true, notifyRecipients: [3, 3, -1, 'x', 2.5, 7] }).notifyRecipients).toEqual([3, 7])
  })
})

// ---------------------------------------------------------------------------
// The notify job, against a stand-in database
// ---------------------------------------------------------------------------

const RID = '11111111-2222-4333-8444-555555555555'
const FORM = '99999999-2222-4333-8444-555555555555'

const emailField = { ...newField('email'), id: 'f_email1', label: 'Your email' }
const textField = { ...newField('short_text'), id: 'f_text01', label: 'Message' }
const DEF: FormDefinition = { ...blankDefinition(), fields: [emailField, textField] as FormDefinition['fields'] }

interface User {
  id: number
  email: string
  platformOwnerId: string | null
  codenames: string[]
  status?: string
}

function world(settings: Record<string, unknown>, opts: { users?: User[]; answers?: Record<string, unknown>; gone?: boolean } = {}) {
  const markers = new Set<string>()
  const windows = new Map<string, number>()
  const deliveries: unknown[][] = []
  const users = opts.users ?? []
  const db = {
    response: {
      findUnique: vi.fn(async () =>
        opts.gone
          ? null
          : {
              id: RID,
              formId: FORM,
              answers: opts.answers ?? { f_email1: 'ada@example.com', f_text01: 'See evil.com/x' },
              submittedAt: new Date('2026-03-01T10:00:00Z'),
              formVersion: { version: 2, definition: DEF },
              form: { title: 'Contact us', settings: { ...defaultFormSettings(), ...settings } },
            },
      ),
    },
    form: {
      findUnique: vi.fn(async () => ({ settings: { ...defaultFormSettings(), ...settings }, webhookSecret: generateWebhookSecret() })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    intelformSettings: { findUnique: vi.fn(async () => ({ appName: 'IntelForm', emailFromName: null, emailReplyTo: 'help@acme.test' })) },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) =>
        users
          .filter((u) => where.id.in.includes(u.id) && (u.status ?? 'active') === 'active')
          .map((u) => ({
            id: u.id,
            email: u.email,
            platformOwnerId: u.platformOwnerId,
            roles: [{ role: { permissions: u.codenames.map((codename) => ({ permission: { codename } })) } }],
          })),
      ),
    },
    intelformRateLimit: { findFirst: vi.fn(async ({ where }: { where: { key: string } }) => (markers.has(where.key) ? { key: where.key } : null)) },
    webhookDelivery: { findFirst: vi.fn(async () => null) },
    $executeRaw: vi.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => {
      // markAllDone sends the keys as one array value; markDone as the first value.
      const list = values.find(Array.isArray) as unknown[] | undefined
      if (list) for (const k of list) markers.add(String(k))
      else markers.add(String(values[0]))
      return 1
    }),
    $queryRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const text = s.join('?')
      if (text.includes('SELECT DISTINCT key FROM intelform_rate_limits')) {
        return (values[0] as string[]).filter((k) => markers.has(k)).map((key) => ({ key }))
      }
      if (text.includes('intelform_rate_limits')) {
        const key = String(values[0])
        windows.set(key, (windows.get(key) ?? 0) + 1)
        return [{ count: windows.get(key) }]
      }
      deliveries.push(values)
      return [{ id: `d${deliveries.length}` }]
    }),
  }
  return { db: db as never, markers, windows, deliveries, raw: db }
}

function fakeMail(fail?: MailError): MailProvider & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return {
    name: 'resend',
    from: 'forms@acme.test',
    sent,
    async send(m) {
      if (fail) throw fail
      sent.push(m)
    },
  }
}

describe('runResponseNotify', () => {
  const relayOk = () => vi.fn(async (_path: string) => 'sent' as const)

  it('skips everything when the response is gone', async () => {
    const w = world({ notifyOnResponse: true }, { gone: true })
    const relay = relayOk()
    expect(await runResponseNotify(w.db, { responseId: RID }, { relay, mail: null })).toMatchObject({ notified: 'skipped' })
    expect(relay).not.toHaveBeenCalled()
  })

  it('rejects bad job data for good', async () => {
    const w = world({})
    await expect(runResponseNotify(w.db, { responseId: 'nope' }, { relay: relayOk(), mail: null })).rejects.toBeInstanceOf(DontRetry)
  })

  it('tells the owner through the relay when no teammates are chosen, once', async () => {
    const w = world({ notifyOnResponse: true })
    const relay = relayOk()
    const out = await runResponseNotify(w.db, { responseId: RID }, { relay, mail: null, origin: 'https://forms.acme.test' })
    expect(out.notified).toBe('owner')
    expect(relay).toHaveBeenCalledWith(responsePath(FORM, RID))
    await runResponseNotify(w.db, { responseId: RID }, { relay, mail: null })
    expect(relay).toHaveBeenCalledTimes(1)
  })

  it('emails chosen teammates who may read responses, one message each, never twice', async () => {
    const users: User[] = [
      { id: 1, email: 'owner@owner.invalid', platformOwnerId: 'own', codenames: ['*'] },
      { id: 2, email: 'ed@acme.test', platformOwnerId: null, codenames: ['site:response:read'] },
      { id: 3, email: 'no@acme.test', platformOwnerId: null, codenames: ['site:form:read'] },
      { id: 4, email: 'gone@acme.test', platformOwnerId: null, codenames: ['*'], status: 'suspended' },
      { id: 5, email: 'admin@acme.test', platformOwnerId: null, codenames: ['site:*'] },
    ]
    const w = world({ notifyOnResponse: true, notifyRecipients: [2, 3, 4, 5] }, { users })
    const mail = fakeMail()
    const relay = relayOk()
    const out = await runResponseNotify(w.db, { responseId: RID }, { relay, mail, origin: 'https://forms.acme.test' })
    expect(out).toMatchObject({ notified: 'team' })
    expect(relay).not.toHaveBeenCalled()
    expect(mail.sent.map((m) => m.to)).toEqual(['ed@acme.test', 'admin@acme.test'])
    expect(mail.sent[0].subject).toBe('New response: Contact us')
    expect(mail.sent[0].text).toContain('Your email\nada@example.com')
    expect(mail.sent[0].text).toContain(`https://forms.acme.test/dashboard/forms/${FORM}/responses?response=${RID}`)
    await runResponseNotify(w.db, { responseId: RID }, { relay, mail })
    expect(mail.sent).toHaveLength(2)
  })

  it('falls back to the owner when teammates are chosen but there is no mail provider', async () => {
    const users: User[] = [{ id: 2, email: 'ed@acme.test', platformOwnerId: null, codenames: ['site:response:read'] }]
    const w = world({ notifyOnResponse: true, notifyRecipients: [2] }, { users })
    const relay = relayOk()
    expect((await runResponseNotify(w.db, { responseId: RID }, { relay, mail: null })).notified).toBe('owner')
    expect(relay).toHaveBeenCalledTimes(1)
  })

  it('sends the confirmation with links stripped from piped answers', async () => {
    const w = world({
      confirmationEmail: true,
      confirmationEmailFieldId: 'f_email1',
      confirmationSubject: 'Thanks {f_email1}\nBcc: x',
      confirmationBody: 'You wrote: {f_text01}. Visit https://acme.test',
    })
    const mail = fakeMail()
    const out = await runResponseNotify(w.db, { responseId: RID }, { relay: relayOk(), mail })
    expect(out.confirmation).toBe('sent')
    expect(mail.sent).toEqual([{ to: 'ada@example.com', subject: 'Thanks ada@example.com Bcc: x', text: 'You wrote: See. Visit https://acme.test', replyTo: 'help@acme.test' }])
    await runResponseNotify(w.db, { responseId: RID }, { relay: relayOk(), mail })
    expect(mail.sent).toHaveLength(1)
  })

  it('skips the confirmation without a provider, with a bad address, or over the hourly cap', async () => {
    const s = { confirmationEmail: true, confirmationEmailFieldId: 'f_email1' }
    expect((await runResponseNotify(world(s).db, { responseId: RID }, { relay: relayOk(), mail: null })).confirmation).toBe('no-provider')
    const bad = world(s, { answers: { f_email1: 'a@x.com, b@y.com' } })
    expect((await runResponseNotify(bad.db, { responseId: RID }, { relay: relayOk(), mail: fakeMail() })).confirmation).toBe('invalid')
    const capped = world(s)
    capped.windows.set(`confirm:${FORM}`, CONFIRM_EMAIL_LIMIT)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mail = fakeMail()
    expect((await runResponseNotify(capped.db, { responseId: RID }, { relay: relayOk(), mail })).confirmation).toBe('capped')
    expect(mail.sent).toHaveLength(0)
    warn.mockRestore()
  })

  it('throws after the other steps when a provider error is worth retrying', async () => {
    const w = world({ notifyOnResponse: true, confirmationEmail: true, confirmationEmailFieldId: 'f_email1' })
    const relay = relayOk()
    await expect(runResponseNotify(w.db, { responseId: RID }, { relay, mail: fakeMail(new MailError('Resend: 503 down', true)) })).rejects.toThrow(
      /Confirmation email: Resend: 503/,
    )
    // The owner notification still went, and is not repeated on the retry.
    expect(relay).toHaveBeenCalledTimes(1)
    const mail = fakeMail()
    await runResponseNotify(w.db, { responseId: RID }, { relay, mail })
    expect(relay).toHaveBeenCalledTimes(1)
    expect(mail.sent).toHaveLength(1)
  })

  it('delivers the webhook inline, and hands a retryable failure to the webhook list', async () => {
    const hook = { webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] } }
    const ok = world(hook)
    const fetchOk = vi.fn(async () => new Response('ok', { status: 200 }))
    expect((await runResponseNotify(ok.db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetchOk as never })).webhook).toBe('delivered')
    const body = JSON.parse(String((fetchOk.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ type: 'response.created', form_id: FORM, response_id: RID, form_version: 2 })

    const down = world(hook)
    const send = vi.fn(async () => ({ id: 'j', list: WEBHOOK_LIST, runAt: '', deduplicated: false, local: false }))
    const fetch503 = vi.fn(async () => new Response('busy', { status: 503 }))
    const out = await runResponseNotify(down.db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetch503 as never, send: send as never })
    expect(out.webhook).toBe('retry-queued')
    expect(send).toHaveBeenCalledWith(expect.any(String), WEBHOOK_LIST, { responseId: RID }, expect.objectContaining({ delay: 60, key: `webhook-${RID}` }))
  })
})

describe('runWebhookDelivery', () => {
  const hook = { webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] } }

  it('throws to retry on 5xx, DontRetry on 4xx, nothing when gone or off', async () => {
    await expect(runWebhookDelivery(world(hook).db, { responseId: RID }, { fetchImpl: (async () => new Response('', { status: 502 })) as never })).rejects.toThrow(
      /answered 502/,
    )
    await expect(
      runWebhookDelivery(world(hook).db, { responseId: RID }, { fetchImpl: (async () => new Response('', { status: 410 })) as never }),
    ).rejects.toBeInstanceOf(DontRetry)
    expect(await runWebhookDelivery(world(hook, { gone: true }).db, { responseId: RID })).toBe('gone')
    expect(await runWebhookDelivery(world({}).db, { responseId: RID })).toBe('off')
    expect(await runWebhookDelivery(world(hook).db, { responseId: RID }, { fetchImpl: (async () => new Response('', { status: 200 })) as never })).toBe(
      'delivered',
    )
  })
})

describe('answersAsText', () => {
  it('lists answered fields with labels', () => {
    expect(answersAsText(DEF, { f_email1: 'a@x.com' }, null)).toBe('Your email\na@x.com')
  })
})
