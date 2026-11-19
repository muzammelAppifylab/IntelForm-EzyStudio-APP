import { describe, expect, it, vi } from 'vitest'
import { blankDefinition, newField, type FormDefinition } from '../../src/lib/intelform/form/definition'
import { defaultFormSettings } from '../../src/lib/intelform/form/settings'
import { DontRetry } from '../../src/platform/background'
import { generateWebhookSecret } from '../../src/server/intelform/webhooks/sign'
import {
  answersAsText,
  CONFIRM_EMAIL_LIMIT,
  formatFrom,
  MailError,
  mailProvider,
  normalizeMessage,
  NOTIFY_EMAILS_PER_HOUR,
  NotifyDeferred,
  notifyRun,
  readNotifySettings,
  sendOwnerDigests,
  responseNeedsJobs,
  responsePath,
  runResponseNotify,
  runWebhookDelivery,
  stripLinks,
  webhookBreaker,
  withoutLinks,
  type MailMessage,
  type MailProvider,
} from '../../src/server/intelform/notify'
import { postmarkProvider, resendProvider } from '../../src/server/intelform/notify/mailer'
import { confirmationSubject } from '../../src/server/intelform/notify/notify'
import { env } from '../integration/support/cloudflare-workers'

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
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer re_key')
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toBe('k1')
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

describe('responseNeedsJobs', () => {
  it('is true only when something is on', () => {
    expect(responseNeedsJobs(defaultFormSettings())).toBe(false)
    expect(responseNeedsJobs({ ...defaultFormSettings(), notifyOnResponse: true })).toBe(true)
    expect(responseNeedsJobs({ webhook: { enabled: true, url: 'https://h.example/x', headers: [] } })).toBe(true)
    expect(responseNeedsJobs({ confirmationEmail: true, confirmationEmailFieldId: 'f_x' })).toBe(true)
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

function world(settings: Record<string, unknown>, opts: { users?: User[]; answers?: Record<string, unknown>; gone?: boolean; ids?: string[] } = {}) {
  const markers = new Set<string>()
  const windows = new Map<string, number>()
  /** intelform_notify_hours, per form (the test's hour). */
  const hours = new Map<string, { notified: number; digest_pending: number; digest_sent: number; confirmed: number; confirm_capped: number }>()
  const deliveries: unknown[][] = []
  const users = opts.users ?? []
  const ids = opts.ids ?? [RID]
  const formSettings = { ...defaultFormSettings(), ...settings }
  const hour = (f: string) => {
    let h = hours.get(f)
    if (!h) hours.set(f, (h = { notified: 0, digest_pending: 0, digest_sent: 0, confirmed: 0, confirm_capped: 0 }))
    return h
  }
  const db = {
    response: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        opts.gone
          ? []
          : where.id.in
              .filter((id) => ids.includes(id))
              .map((id) => ({
                id,
                formId: FORM,
                answers: opts.answers ?? { f_email1: 'ada@example.com', f_text01: 'See evil.com/x' },
                submittedAt: new Date('2026-03-01T10:00:00Z'),
                formVersion: { version: 2, definition: DEF },
                form: { title: 'Contact us', settings: formSettings, webhookSecret: generateWebhookSecret() },
              })),
      ),
    },
    form: {
      findUnique: vi.fn(async () => ({ settings: formSettings, webhookSecret: generateWebhookSecret() })),
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
    $executeRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const text = s.join('?')
      if (text.includes('digest_pending = t.digest_pending + 1')) {
        // addToDigest: the hour's digest count and the step's marker.
        hour(String(values[0])).digest_pending++
        markers.add(String(values[1]))
        return 1
      }
      // markAllDone sends the keys as one array value; markDone as the first value.
      const list = values.find(Array.isArray) as unknown[] | undefined
      if (list) for (const k of list) markers.add(String(k))
      else markers.add(String(values[0]))
      return 1
    }),
    $queryRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const text = s.join('?')
      if (text.includes('FROM intelform_done_markers WHERE key = ANY')) {
        return (values[0] as string[]).filter((k) => markers.has(k)).map((key) => ({ key }))
      }
      // Webhooks already delivered: none in this stand-in (a success returns 'delivered' itself).
      if (text.includes('FROM webhook_deliveries')) return []
      if (text.includes('INSERT INTO intelform_notify_hours')) {
        // countResponse: [form, n, n, NL, c, c, CL, ...]; the keys are the `job:` strings, in order.
        const [form, n, , NL, c, , CL] = values as [string, number, number, number, number, number, number]
        const h = hour(form)
        h.notified += n
        if (n && h.notified > NL) h.digest_pending++
        h.confirmed += c
        if (c && h.confirmed > CL) h.confirm_capped++
        const [digestKey, countedKey, cappedKey, confirmCounted] = values.filter((v) => typeof v === 'string' && v.startsWith('job:')) as string[]
        if (n) markers.add(h.notified > NL ? digestKey! : countedKey!)
        if (c) markers.add(h.confirmed > CL ? cappedKey! : confirmCounted!)
        return [{ notified: h.notified, confirmed: h.confirmed, confirm_capped: h.confirm_capped }]
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
  return { db: db as never, markers, windows, hours, deliveries, raw: db }
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
    // The subject never carries an answer (a piped one shows its fallback or nothing), nor a line break.
    expect(mail.sent).toEqual([{ to: 'ada@example.com', subject: 'Thanks Bcc: x', text: 'You wrote: See. Visit https://acme.test', replyTo: 'help@acme.test' }])
    await runResponseNotify(w.db, { responseId: RID }, { relay: relayOk(), mail })
    expect(mail.sent).toHaveLength(1)
  })

  it('skips the confirmation without a provider, with a bad address, or over the hourly cap', async () => {
    const s = { confirmationEmail: true, confirmationEmailFieldId: 'f_email1' }
    expect((await runResponseNotify(world(s).db, { responseId: RID }, { relay: relayOk(), mail: null })).confirmation).toBe('no-provider')
    const bad = world(s, { answers: { f_email1: 'a@x.com, b@y.com' } })
    expect((await runResponseNotify(bad.db, { responseId: RID }, { relay: relayOk(), mail: fakeMail() })).confirmation).toBe('invalid')
    const capped = world(s)
    capped.hours.set(FORM, { notified: 0, digest_pending: 0, digest_sent: 0, confirmed: CONFIRM_EMAIL_LIMIT, confirm_capped: 0 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mail = fakeMail()
    expect((await runResponseNotify(capped.db, { responseId: RID }, { relay: relayOk(), mail })).confirmation).toBe('capped')
    expect(mail.sent).toHaveLength(0)
    warn.mockRestore()
  })

  it('confirmation caps: per address block (marked at submit), per form an hour, per recipient a day, per site a day', async () => {
    const s = { confirmationEmail: true, confirmationEmailFieldId: 'f_email1' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    env.JWT_SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
    try {
      // The submit marked this response: its network asked for over 3 this hour.
      const ip = world(s)
      ip.markers.add(`job:confirm-skip-ip:${RID}`)
      const mail = fakeMail()
      expect((await runResponseNotify(ip.db, { responseId: RID }, { relay: relayOk(), mail })).confirmation).toBe('capped')
      expect(mail.sent).toHaveLength(0)
      // Logged once for the form and the hour (the activity log), and the owner alert is counted once.
      expect(ip.windows.get(`abuse-log:confirm-skipped:ip:${FORM}`)).toBe(1)
      expect(ip.windows.get(`abuse-alert:mail:${FORM}`)).toBe(1)

      // The form's own hourly limit (its Spam protection setting, 100 by default).
      expect(readNotifySettings({ confirmPerHour: 7 }).confirmPerHour).toBe(7)
      expect(readNotifySettings({ confirmPerHour: 0 }).confirmPerHour).toBe(100)
      const form = world({ ...s, confirmPerHour: 2 })
      form.hours.set(FORM, { notified: 0, digest_pending: 0, digest_sent: 0, confirmed: 2, confirm_capped: 0 })
      expect((await runResponseNotify(form.db, { responseId: RID }, { relay: relayOk(), mail })).confirmation).toBe('capped')

      // One address: once a day from one form (a second response with it gets none).
      const twice = world(s, { ids: [RID, '11111111-2222-4333-8444-666666666666'] })
      expect((await runResponseNotify(twice.db, { responseId: RID }, { relay: relayOk(), mail })).confirmation).toBe('sent')
      expect((await runResponseNotify(twice.db, { responseId: '11111111-2222-4333-8444-666666666666' }, { relay: relayOk(), mail })).confirmation).toBe('capped')
      expect(mail.sent).toHaveLength(1)

      // The site's day across every form (1,000 by default).
      const site = world(s)
      site.windows.set('confirm-site', 1000)
      expect((await runResponseNotify(site.db, { responseId: RID }, { relay: relayOk(), mail })).confirmation).toBe('capped')
      expect(mail.sent).toHaveLength(1)
    } finally {
      delete env.JWT_SECRET
      warn.mockRestore()
    }
  })

  it('the confirmation subject never carries an answer', () => {
    const def = DEF
    expect(confirmationSubject('Thanks {f_text01}', def, 'Contact us')).toBe('Thanks')
    expect(confirmationSubject('{f_text01}', def, 'Contact us')).toBe('Contact us')
    expect(confirmationSubject('Hi {f_text01|there}', def, 'Contact us')).toBe('Hi there')
    expect(confirmationSubject('', def, 'Contact us')).toBe('Contact us')
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

  it('delivers the webhook inline, and throws a retryable failure without sending any job', async () => {
    const hook = { webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] } }
    const ok = world(hook)
    const fetchOk = vi.fn(async () => new Response('ok', { status: 200 }))
    expect((await runResponseNotify(ok.db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetchOk as never })).webhook).toBe('delivered')
    const body = JSON.parse(String((fetchOk.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ type: 'response.created', form_id: FORM, response_id: RID, form_version: 2 })

    const down = world(hook)
    const fetch503 = vi.fn(async () => new Response('busy', { status: 503 }))
    await expect(runResponseNotify(down.db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetch503 as never })).rejects.toThrow(
      /answered 503.*Trying again later/,
    )
    // Not marked done: the next run tries the webhook again, and then it's delivered once.
    expect([...down.markers].some((k) => k.startsWith('job:webhook:'))).toBe(false)
    expect((await runResponseNotify(down.db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetchOk as never })).webhook).toBe('delivered')

    // A 4xx is final: marked done, never retried.
    const gone = world(hook)
    const out = await runResponseNotify(gone.db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: (async () => new Response('', { status: 410 })) as never })
    expect(out.webhook).toBe('failed')
  })

  it('skips an endpoint that keeps failing for the rest of a drain run', async () => {
    const hook = { webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] } }
    const breaker = webhookBreaker(2)
    const fetch503 = vi.fn(async () => new Response('busy', { status: 503 }))
    for (let i = 0; i < 2; i++) {
      await expect(runResponseNotify(world(hook).db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetch503 as never, webhookBreaker: breaker })).rejects.toThrow()
    }
    expect(fetch503).toHaveBeenCalledTimes(2)
    await expect(runResponseNotify(world(hook).db, { responseId: RID }, { relay: relayOk(), mail: null, fetchImpl: fetch503 as never, webhookBreaker: breaker })).rejects.toThrow(
      /keeps failing/,
    )
    expect(fetch503).toHaveBeenCalledTimes(2)
    expect(breaker.isOpen('another-form')).toBe(false)
    breaker.record(FORM, true)
    expect(breaker.isOpen(FORM)).toBe(false)
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

// ---------------------------------------------------------------------------
// Speed: steps at once, one run's shared reads; email limits: digest and caps
// ---------------------------------------------------------------------------

describe('runResponseNotify at volume', () => {
  const rid = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
  const all = { notifyOnResponse: true, confirmationEmail: true, confirmationEmailFieldId: 'f_email1', webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] } }

  it('runs the notification, the confirmation and the webhook at the same time', async () => {
    const w = world(all)
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const relay = vi.fn(async () => {
      started.push('relay')
      await gate
      return 'sent' as const
    })
    const mail: MailProvider = {
      name: 'resend',
      from: 'f@acme.test',
      async send() {
        started.push('mail')
        await gate
      },
    }
    const fetchImpl = vi.fn(async () => {
      started.push('webhook')
      await gate
      return new Response('ok', { status: 200 })
    })
    const p = runResponseNotify(w.db, { responseId: RID }, { relay, mail, fetchImpl: fetchImpl as never, origin: null })
    // Every outside call is in flight before any of them answers.
    await vi.waitFor(() => expect(started.sort()).toEqual(['mail', 'relay', 'webhook']))
    release()
    expect(await p).toMatchObject({ notified: 'owner', confirmation: 'sent', webhook: 'delivered' })
  })

  it('reads settings, teammates, responses and markers once per run, not per response', async () => {
    const users: User[] = [{ id: 2, email: 'ed@acme.test', platformOwnerId: null, codenames: ['site:response:read'] }]
    const ids = [1, 2, 3, 4, 5].map(rid)
    const w = world({ ...all, notifyRecipients: [2] }, { users, ids })
    const mail = fakeMail()
    const run = notifyRun(w.db, { relay: vi.fn(async () => 'sent' as const), mail, origin: null, fetchImpl: (async () => new Response('', { status: 200 })) as never })
    await run.preload(ids)
    for (const id of ids) await runResponseNotify(w.db, { responseId: id }, { run })
    expect(w.raw.response.findMany).toHaveBeenCalledTimes(1)
    expect(w.raw.user.findMany).toHaveBeenCalledTimes(1)
    expect(w.raw.intelformSettings.findUnique).toHaveBeenCalledTimes(1)
    expect(w.raw.form.findUnique).not.toHaveBeenCalled() // the webhook used the run's form row
    const markerReads = w.raw.$queryRaw.mock.calls.filter((c) => (c[0] as TemplateStringsArray).join('?').includes('FROM intelform_done_markers'))
    expect(markerReads).toHaveLength(1)
    expect(mail.sent.map((m) => m.to).sort()).toEqual([...Array(5).fill('ada@example.com'), ...Array(5).fill('ed@acme.test')].sort())
  })

  it('emails the first ones of the hour one by one and counts the rest for the digest, never twice', async () => {
    const ids = Array.from({ length: NOTIFY_EMAILS_PER_HOUR + 3 }, (_, i) => rid(i + 1))
    const w = world({ notifyOnResponse: true }, { ids })
    const relay = vi.fn(async () => 'sent' as const)
    const outs = []
    for (const id of ids) outs.push(await runResponseNotify(w.db, { responseId: id }, { relay, mail: null, origin: null }))
    expect(relay).toHaveBeenCalledTimes(NOTIFY_EMAILS_PER_HOUR)
    expect(outs.filter((o) => o.notified === 'digest')).toHaveLength(3)
    expect(w.hours.get(FORM)).toMatchObject({ notified: NOTIFY_EMAILS_PER_HOUR + 3, digest_pending: 3 })
    // A retry of a digested response is not counted again, and still sends nothing.
    expect((await runResponseNotify(w.db, { responseId: ids.at(-1)! }, { relay, mail: null, origin: null })).notified).toBe('digest')
    expect(w.hours.get(FORM)!.digest_pending).toBe(3)
    expect(relay).toHaveBeenCalledTimes(NOTIFY_EMAILS_PER_HOUR)
  })

  it('puts an owner email the platform refused for its limit (429) in the digest, not lost', async () => {
    const w = world({ notifyOnResponse: true })
    const relay = vi.fn(async () => 'limited' as const)
    expect((await runResponseNotify(w.db, { responseId: RID }, { relay, mail: null, origin: null })).notified).toBe('digest')
    expect(w.hours.get(FORM)!.digest_pending).toBe(1)
    expect(w.markers.has(`job:notify:${RID}:owner`)).toBe(true)
  })

  it('counts confirmations held back by the cap, and logs once per form per hour', async () => {
    const ids = [1, 2, 3].map(rid)
    const w = world({ confirmationEmail: true, confirmationEmailFieldId: 'f_email1' }, { ids })
    w.hours.set(FORM, { notified: 0, digest_pending: 0, digest_sent: 0, confirmed: CONFIRM_EMAIL_LIMIT - 1, confirm_capped: 0 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mail = fakeMail()
    const outs = []
    for (const id of ids) outs.push((await runResponseNotify(w.db, { responseId: id }, { relay: vi.fn(), mail, origin: null })).confirmation)
    expect(outs).toEqual(['sent', 'capped', 'capped'])
    expect(w.hours.get(FORM)!.confirm_capped).toBe(2)
    const capLogs = warn.mock.calls.filter((c) => String(c[0]).includes('hourly limit'))
    expect(capLogs).toHaveLength(1)
    expect(String(capLogs[0]![0])).not.toContain('@')
    // A capped response run again stays capped (not counted twice, not sent).
    expect((await runResponseNotify(w.db, { responseId: ids[2]! }, { relay: vi.fn(), mail, origin: null })).confirmation).toBe('capped')
    expect(w.hours.get(FORM)!.confirm_capped).toBe(2)
    expect(mail.sent).toHaveLength(1)
    warn.mockRestore()
  })

  it('holds a response back without an attempt when only the webhook breaker stopped it', async () => {
    const hook = { webhook: { enabled: true, url: 'https://hooks.example.com/in', headers: [] } }
    const breaker = webhookBreaker(1)
    breaker.start(FORM)
    breaker.record(FORM, false)
    await expect(runResponseNotify(world(hook).db, { responseId: RID }, { relay: vi.fn(), mail: null, webhookBreaker: breaker })).rejects.toBeInstanceOf(NotifyDeferred)
  })

  it('lets one call through at a time to an endpoint that has failed', () => {
    const b = webhookBreaker(3)
    b.start(FORM)
    b.record(FORM, false)
    expect(b.isOpen(FORM)).toBe(false)
    b.start(FORM) // a probe in flight: the others wait for its answer
    expect(b.isOpen(FORM)).toBe(true)
    b.record(FORM, true)
    expect(b.isOpen(FORM)).toBe(false)
  })
})

describe('sendOwnerDigests', () => {
  const H1 = new Date('2026-03-01T10:00:00Z')
  const F2 = '88888888-2222-4333-8444-555555555555'

  function digestDb(rows: { form_id: string; digest_pending: number; digest_sent: number; settings: Record<string, unknown> }[], users: User[] = []) {
    const updates: unknown[][] = []
    const markers = new Set<string>()
    const db = {
      intelformSettings: { findUnique: vi.fn(async () => ({ appName: 'IntelForm', emailFromName: null, emailReplyTo: null })) },
      user: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) =>
          users
            .filter((u) => where.id.in.includes(u.id))
            .map((u) => ({ id: u.id, email: u.email, platformOwnerId: u.platformOwnerId, roles: [{ role: { permissions: u.codenames.map((codename) => ({ permission: { codename } })) } }] })),
        ),
      },
      $queryRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
        const text = s.join('?')
        if (text.includes('FROM intelform_notify_hours h JOIN forms f')) {
          return rows.map((r) => ({ ...r, hour: H1, title: `Form ${r.form_id.slice(0, 2)}`, settings: { ...defaultFormSettings(), ...r.settings } }))
        }
        if (text.includes('FROM intelform_done_markers')) return (values[0] as string[]).filter((k) => markers.has(k)).map((key) => ({ key }))
        throw new Error(`unexpected query: ${text}`)
      }),
      $executeRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
        const text = s.join('?')
        if (text.includes('UPDATE intelform_notify_hours')) updates.push(values)
        else if (text.includes('INSERT INTO intelform_done_markers')) for (const k of values.find(Array.isArray) as string[]) markers.add(k)
        return 1
      }),
    }
    return { db: db as never, updates, markers }
  }

  it('sends the owner ONE email for every busy form, then marks them sent', async () => {
    const d = digestDb([
      { form_id: FORM, digest_pending: 40, digest_sent: 0, settings: { notifyOnResponse: true } },
      { form_id: F2, digest_pending: 5, digest_sent: 2, settings: { notifyOnResponse: true } },
    ])
    const relay = vi.fn(async (_p: string) => 'sent' as const)
    expect(await sendOwnerDigests(d.db, 'https://x.test/', { budgetMs: 10_000, relay, mail: null })).toEqual({ sent: 1 })
    expect(relay).toHaveBeenCalledTimes(1)
    expect(relay).toHaveBeenCalledWith('/dashboard/forms/')
    expect(d.updates).toHaveLength(1)
    expect(d.updates[0]![0]).toEqual([FORM, F2])
    expect(d.updates[0]![2]).toEqual([40, 5])
  })

  it('keeps the digest pending when the platform refuses it for its limit', async () => {
    const d = digestDb([{ form_id: FORM, digest_pending: 3, digest_sent: 0, settings: { notifyOnResponse: true } }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const relay = vi.fn(async () => 'limited' as const)
    expect(await sendOwnerDigests(d.db, 'https://x.test/', { budgetMs: 10_000, relay, mail: null })).toEqual({ sent: 0 })
    expect(relay).toHaveBeenCalledWith(`/dashboard/forms/${FORM}/responses`)
    expect(d.updates).toHaveLength(0)
    warn.mockRestore()
  })

  it('emails each chosen teammate one digest per form with the count, once', async () => {
    const users: User[] = [{ id: 2, email: 'ed@acme.test', platformOwnerId: null, codenames: ['site:response:read'] }]
    const d = digestDb([{ form_id: FORM, digest_pending: 12, digest_sent: 0, settings: { notifyOnResponse: true, notifyRecipients: [2] } }], users)
    const mail = fakeMail()
    const relay = vi.fn(async () => 'sent' as const)
    expect(await sendOwnerDigests(d.db, 'https://x.test/', { budgetMs: 10_000, relay, mail })).toEqual({ sent: 1 })
    expect(relay).not.toHaveBeenCalled()
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]).toMatchObject({ to: 'ed@acme.test', subject: '12 new responses: Form 99' })
    expect(d.updates).toHaveLength(1)
    // Run again before the mark landed (a crash): the marker keeps it from going twice.
    await sendOwnerDigests(d.db, 'https://x.test/', { budgetMs: 10_000, relay, mail })
    expect(mail.sent).toHaveLength(1)
  })

  it('closes the count without sending when notifications were turned off', async () => {
    const d = digestDb([{ form_id: FORM, digest_pending: 3, digest_sent: 0, settings: { notifyOnResponse: false } }])
    const relay = vi.fn(async () => 'sent' as const)
    expect(await sendOwnerDigests(d.db, 'https://x.test/', { budgetMs: 10_000, relay, mail: null })).toEqual({ sent: 0 })
    expect(relay).not.toHaveBeenCalled()
    expect(d.updates).toHaveLength(1)
  })
})
