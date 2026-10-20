import { createTransport, type Transporter } from 'nodemailer'
import { sql, type Queryable } from '../db/client'
import { env } from '../env'
import { enqueue, registerJob } from './jobs'
import { logger } from './logger'
import { getSetting, onSettingChange, readSecret, type AppSettings } from './settings'

/**
 * The one email interface. Routes never call a provider: they `queueEmail(tx, message)` inside
 * their transaction and the jobs worker sends it (3 attempts with backoff).
 *
 * The provider is configured by the Owner in Settings (app_settings key "email", secrets
 * encrypted). EMAIL_DRIVER=console|none in the environment overrides that, for development.
 */
export interface EmailMessage {
  to: string | string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export interface EmailDriver {
  send(m: EmailMessage & { to: string[]; from: string }): Promise<{ id?: string }>
  /** Checks the credentials without sending anything. Throws with a readable message. */
  verify(): Promise<void>
}

type EmailConfig = AppSettings['email']

const TIMEOUT_MS = 15_000

function consoleDriver(): EmailDriver {
  return {
    async send(m) {
      // Development: print the message so links (invites, resets) can be copied from the log.
      console.log(`\n--- email to ${m.to.join(', ')} ---\nFrom: ${m.from}\nSubject: ${m.subject}\n\n${m.text}\n--- end email ---\n`)
      return {}
    },
    async verify() {},
  }
}

function smtpDriver(cfg: EmailConfig): EmailDriver {
  if (!cfg.smtpHost) throw new Error('Enter the SMTP host')
  const pass = readSecret(cfg.smtpPass)
  const transport: Transporter = createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort ?? (cfg.smtpSecure ? 465 : 587),
    secure: cfg.smtpSecure,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: pass ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })
  return {
    async send(m) {
      const info = await transport.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo })
      return { id: info.messageId }
    },
    async verify() {
      await transport.verify()
    },
  }
}

async function readError(res: Response): Promise<string> {
  const text = (await res.text().catch(() => '')).slice(0, 300)
  try {
    const j = JSON.parse(text) as { message?: string; Message?: string }
    return j.message ?? j.Message ?? text
  } catch {
    return text || res.statusText
  }
}

function resendDriver(cfg: EmailConfig): EmailDriver {
  const key = readSecret(cfg.resendApiKey)
  if (!key) throw new Error('Enter the Resend API key')
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    async send(m) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`Resend: ${res.status} ${await readError(res)}`)
      const j = (await res.json()) as { id?: string }
      return { id: j.id }
    },
    async verify() {
      // A sending-only key can't list domains (401 restricted_api_key), which still proves it is valid.
      const res = await fetch('https://api.resend.com/domains', { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.ok) return
      const message = await readError(res)
      if (res.status === 401 && /restricted/i.test(message)) return
      throw new Error(`Resend rejected the API key: ${message}`)
    },
  }
}

function postmarkDriver(cfg: EmailConfig): EmailDriver {
  const token = readSecret(cfg.postmarkToken)
  if (!token) throw new Error('Enter the Postmark server token')
  const headers = { 'X-Postmark-Server-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' }
  return {
    async send(m) {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          From: m.from,
          To: m.to.join(','),
          Subject: m.subject,
          TextBody: m.text,
          HtmlBody: m.html,
          ReplyTo: m.replyTo,
          MessageStream: 'outbound',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`Postmark: ${res.status} ${await readError(res)}`)
      const j = (await res.json()) as { MessageID?: string }
      return { id: j.MessageID }
    },
    async verify() {
      const res = await fetch('https://api.postmarkapp.com/server', { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) throw new Error(`Postmark rejected the server token: ${await readError(res)}`)
    },
  }
}

/** Builds the driver for a config. Returns null for "none"; throws when required settings are missing. */
export function buildDriver(cfg: EmailConfig): EmailDriver | null {
  switch (cfg.driver) {
    case 'none':
      return null
    case 'console':
      return consoleDriver()
    case 'smtp':
      return smtpDriver(cfg)
    case 'resend':
      return resendDriver(cfg)
    case 'postmark':
      return postmarkDriver(cfg)
  }
}

// ---------------------------------------------------------------------------
// Active driver (cached until the email setting changes; 60 s TTL for other instances)
// ---------------------------------------------------------------------------

interface Active {
  driver: EmailDriver | null
  from: string
  replyTo?: string
  at: number
}
let cache: Active | null = null
const TTL_MS = 60_000
onSettingChange((key) => {
  if (key === 'email' || key === 'general') cache = null
})

/** Override for tests: replaces the active driver until reset with `null`. */
let testDriver: EmailDriver | null | undefined
export function setTestEmailDriver(driver: EmailDriver | null | undefined): void {
  testDriver = driver
  cache = null
}

function formatFrom(name: string | null, address: string): string {
  if (!name) return address
  return `"${name.replace(/["\\\r\n]/g, '')}" <${address}>`
}

async function active(): Promise<Active> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache
  const [cfg, general] = await Promise.all([getSetting('email'), getSetting('general')])
  const fallbackFrom = `no-reply@${new URL(env.APP_URL).hostname}`
  const from = formatFrom(cfg.fromName ?? general.appName, cfg.fromAddress ?? fallbackFrom)
  let driver: EmailDriver | null
  if (testDriver !== undefined) driver = testDriver
  else if (env.EMAIL_DRIVER) driver = env.EMAIL_DRIVER === 'console' ? consoleDriver() : null
  else {
    try {
      driver = buildDriver(cfg)
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'email provider is incomplete; email is off')
      driver = null
    }
  }
  cache = { driver, from, replyTo: cfg.replyTo ?? undefined, at: Date.now() }
  return cache
}

/** Whether emails go out right now. False hides "Forgot password" and shows copyable invite links. */
export async function emailEnabled(): Promise<boolean> {
  return (await active()).driver !== null
}

/** One plain address: no display name, comma, angle bracket, whitespace or line break. */
const SINGLE_ADDRESS = /^[^\s@,;<>"()\\]+@[^\s@,;<>"()\\]+\.[^\s@,;<>"()\\]+$/

/**
 * Header safety for every message, whatever the caller passed (header injection): the
 * subject loses line breaks and other control characters, and each recipient must be exactly
 * one plain address (a respondent's answer like "a@x.com, b@y.com" or "a@x.com\r\nBcc: …"
 * is dropped, not split).
 */
export function normalize(m: EmailMessage): EmailMessage & { to: string[] } {
  const to = (Array.isArray(m.to) ? m.to : [m.to]).map((a) => String(a).trim()).filter((a) => a.length <= 254 && SINGLE_ADDRESS.test(a))
  const replyTo = m.replyTo && SINGLE_ADDRESS.test(m.replyTo.trim()) ? m.replyTo.trim() : undefined
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  const subject = String(m.subject).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, 300)
  return { ...m, to, subject, replyTo }
}

/**
 * Sends right now, bypassing the queue. Only the email job and Settings "Send test" use this;
 * routes use `queueEmail`. Returns false when email is off.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const a = await active()
  if (!a.driver) return false
  const m = normalize(message)
  if (!m.to.length) {
    logger.warn('email dropped: no valid recipient')
    return false
  }
  await a.driver.send({ ...m, from: a.from, replyTo: m.replyTo ?? a.replyTo })
  return true
}

/**
 * Queues an email in the caller's transaction. Returns false (and queues nothing) when email
 * is off, so callers can fall back, e.g. to a copyable link.
 */
export async function queueEmail(tx: Queryable, message: EmailMessage): Promise<boolean> {
  if (!(await emailEnabled())) return false
  const m = normalize(message)
  if (!m.to.length) return false
  await enqueue(tx, 'email', m, { maxAttempts: 3 })
  return true
}

registerJob<EmailMessage>('email', async (message) => {
  // Email may have been switched off since the job was queued: drop it quietly.
  await sendEmail(message)
})

/** Settings "Send test": verify the stored (or given) config, then send one message now. */
export async function verifyEmailConfig(cfg?: EmailConfig): Promise<void> {
  const driver = cfg ? buildDriver(cfg) : (await active()).driver
  if (!driver) throw new Error('Choose an email provider first')
  await driver.verify()
}

export async function sendTestEmail(to: string): Promise<void> {
  const a = await active()
  if (!a.driver) throw new Error('Choose an email provider first')
  await a.driver.verify()
  const { appName } = await getSetting('general')
  await a.driver.send({
    to: normalize({ to, subject: '', text: '' }).to,
    from: a.from,
    replyTo: a.replyTo,
    subject: `Test email from ${appName}`,
    text: `This is a test email from ${appName}. If you can read it, email is set up correctly.`,
  })
}

/** Used by SQL-only callers that only need to know if anything is queued (tests, health). */
export async function pendingEmailCount(): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE kind = 'email' AND done_at IS NULL AND failed_at IS NULL`
  return n
}
