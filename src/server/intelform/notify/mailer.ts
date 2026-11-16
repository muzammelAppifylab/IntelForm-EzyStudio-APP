import { config } from '../../../platform/config'

/**
 * Emails with IntelForm's OWN text (the answers to a teammate, the respondent's confirmation).
 *
 * The platform relay (`sendSiteEmail`, kind `notification`) only sends the platform's own
 * templates, and only to the site owner. Text of the form's own, or mail to anyone else, needs
 * a mail provider the OWNER adds as site secrets (security.md › Calling other services):
 *
 *   RESEND_API_KEY        (https://api.resend.com)       or
 *   POSTMARK_SERVER_TOKEN (https://api.postmarkapp.com)
 *   EMAIL_FROM_ADDRESS    the sender, on a domain verified with that provider
 *
 * Without them `mailProvider()` is null: owner notifications still go through the relay, and
 * confirmations and teammate emails are skipped. Fixed https origins, a timeout, the key only
 * from `config.ownerSecret`, never logged.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  replyTo?: string | null
}

export interface MailProvider {
  name: 'resend' | 'postmark'
  from: string
  /** Sends one message; throws `MailError` on a provider failure (`retryable` says whether to try again). */
  send(m: MailMessage, opts?: { idempotencyKey?: string }): Promise<void>
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

const TIMEOUT_MS = 15_000

/** One plain address: no display name, comma, angle bracket, whitespace or line break. */
const SINGLE_ADDRESS = /^[^\s@,;<>"()\\]+@[^\s@,;<>"()\\]+\.[^\s@,;<>"()\\]+$/

export function isSingleAddress(a: unknown): a is string {
  return typeof a === 'string' && a.length <= 254 && SINGLE_ADDRESS.test(a)
}

/**
 * Header safety for every message (header injection): the subject loses line breaks and other
 * control characters; the recipient must be exactly one plain address (a respondent's answer
 * like "a@x.com, b@y.com" or "a@x.com\r\nBcc: …" is dropped, not split). Null = don't send.
 */
export function normalizeMessage(m: MailMessage): MailMessage | null {
  const to = String(m.to ?? '').trim()
  if (!isSingleAddress(to)) return null
  const replyTo = m.replyTo && isSingleAddress(m.replyTo.trim()) ? m.replyTo.trim() : null
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  const subject = String(m.subject).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, 300)
  return { to, subject, text: String(m.text ?? '').slice(0, 100_000), replyTo }
}

/** `"Name" <address>` with the name's quotes and line breaks removed. */
export function formatFrom(name: string | null | undefined, address: string): string {
  const clean = (name ?? '').replace(/["\\\r\n<>]/g, '').trim()
  return clean ? `"${clean}" <${address}>` : address
}

async function readError(res: Response): Promise<string> {
  const text = (await res.text().catch(() => '')).slice(0, 300)
  try {
    const j = JSON.parse(text) as { message?: string; Message?: string }
    return String(j.message ?? j.Message ?? text).slice(0, 200)
  } catch {
    return text.slice(0, 200) || res.statusText
  }
}

function failure(provider: string, res: Response, detail: string): MailError {
  return new MailError(`${provider}: ${res.status} ${detail}`, res.status === 429 || res.status >= 500)
}

function network(provider: string, err: unknown): MailError {
  const timeout = (err as { name?: string })?.name === 'TimeoutError'
  return new MailError(timeout ? `${provider} did not answer in time` : `${provider} could not be reached`, true)
}

export function resendProvider(key: string, from: string, fetchImpl: typeof fetch = fetch): MailProvider {
  return {
    name: 'resend',
    from,
    async send(m, opts = {}) {
      let res: Response
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey.slice(0, 256) } : {}),
          },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (err) {
        throw network('Resend', err)
      }
      if (!res.ok) throw failure('Resend', res, await readError(res))
      await res.body?.cancel().catch(() => {})
    },
  }
}

export function postmarkProvider(token: string, from: string, fetchImpl: typeof fetch = fetch): MailProvider {
  return {
    name: 'postmark',
    from,
    async send(m) {
      let res: Response
      try {
        res = await fetchImpl('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { 'X-Postmark-Server-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: from,
            To: m.to,
            Subject: m.subject,
            TextBody: m.text,
            ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
            MessageStream: 'outbound',
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (err) {
        throw network('Postmark', err)
      }
      if (!res.ok) throw failure('Postmark', res, await readError(res))
      await res.body?.cancel().catch(() => {})
    },
  }
}

/**
 * The provider the owner set up, or null. `fromName` is the sender name (IntelForm settings
 * `emailFromName`, else the app name).
 */
export function mailProvider(fromName: string | null, secret: (name: string) => string | null = (n) => config.ownerSecret(n)): MailProvider | null {
  const address = secret('EMAIL_FROM_ADDRESS')?.trim() ?? ''
  if (!isSingleAddress(address)) return null
  const from = formatFrom(fromName, address)
  const resend = secret('RESEND_API_KEY')
  if (resend) return resendProvider(resend, from)
  const postmark = secret('POSTMARK_SERVER_TOKEN')
  if (postmark) return postmarkProvider(postmark, from)
  return null
}

/** For the builder's capability note: can IntelForm send its own emails (confirmations)? */
export function mailProviderConfigured(): boolean {
  return mailProvider(null) !== null
}
