import { SiteKeyMissing, siteKeyPost } from '../../../platform/api'
import { grants } from '../../../platform/auth/codenames'
import { DontRetry, JobRejected, sendJob } from '../../../platform/background'
import { config } from '../../../platform/config'
import type { PrismaClient } from '../../../platform/db'
import { localDevEmailLines } from '../../../platform/local-dev'
import { interpolate } from '../../../lib/intelform/form/logic'
import { EMAIL_RE } from '../../../lib/intelform/form/types/registry'
import { PERMISSIONS } from '../../permissions'
import { deliveredOnce, deliverWebhook, readWebhookConfig, WebhookError, webhookPayload, type DeliveryResult } from '../webhooks'
import { answersAsText, readAnswers, readDefinition } from './answers'
import { withoutLinks } from './links'
import { MailError, mailProvider, normalizeMessage, type MailProvider } from './mailer'
import { doneKey, hitWindow, isDone, markDone } from './markers'
import { readNotifySettings, type NotifySettings } from './settings'

/**
 * What a new response sets off (legacy server/respondent/notify.ts), as background jobs
 * (docs/agent/background-jobs.md):
 *
 *   intelform-response-notify   one job per response: the team notification, the respondent's
 *                               confirmation and the first webhook attempt;
 *   intelform-webhook-deliver   only when that first attempt failed in a way worth retrying:
 *                               the platform tries again (background.json `retries`).
 *
 * One job per response (not three) keeps a busy form under the site's "jobs added per minute"
 * limit. Each step is marked done (`./markers.ts`), so a job that runs again never sends the
 * same email twice; a failed step throws after the others ran, and only it is tried again.
 */

export const NOTIFY_LIST = 'intelform-response-notify'
export const WEBHOOK_LIST = 'intelform-webhook-deliver'

/** Confirmation emails per form per hour: a form can't be turned into a bulk mailer. */
export const CONFIRM_EMAIL_LIMIT = 200
/** Delay before the webhook job's first retry (seconds). */
export const WEBHOOK_RETRY_DELAY = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The address handlers use to reach the platform (a job has no request): the site's own. */
export function jobRequestUrl(): string {
  return config.siteUrl ?? 'http://localhost/'
}

/** The dashboard link to one response. */
export function responsePath(formId: string, responseId: string): string {
  return `/dashboard/forms/${encodeURIComponent(formId)}/responses?response=${encodeURIComponent(responseId)}`
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// ---------------------------------------------------------------------------
// Sending the job (from the submit route, AFTER its transaction committed)
// ---------------------------------------------------------------------------

export interface SubmittedFor {
  formId: string
  formTitle: string
  responseId: string
  /** The form's settings as stored (forms.settings). */
  settings: unknown
}

/** True when a new response has anything to send (notification, confirmation or webhook). */
export function responseNeedsJobs(settings: unknown): boolean {
  const s = readNotifySettings(settings)
  return s.notifyOnResponse || (s.confirmationEmail && !!s.confirmationEmailFieldId) || readWebhookConfig(settings).enabled
}

/**
 * Sends the response's notify job. Call it after the submit transaction committed (never
 * inside one). Never throws: a refused send (the per-minute limit, the platform down) is
 * logged and the respondent's answer stands. Returns whether a job was sent.
 */
export async function queueResponseJobs(requestUrl: string | URL, r: SubmittedFor, send: typeof sendJob = sendJob): Promise<boolean> {
  if (!responseNeedsJobs(r.settings)) return false
  try {
    await send(requestUrl, NOTIFY_LIST, { responseId: r.responseId }, {
      key: `notify-${r.responseId}`,
      label: clip(`New response · ${r.formTitle || 'Untitled form'}`, 120),
    })
    return true
  } catch (err) {
    const code = err instanceof JobRejected ? err.code : 'error'
    console.warn(`[intelform] notify job not sent for a response (${code})`)
    return false
  }
}

// ---------------------------------------------------------------------------
// The platform relay (owner notification)
// ---------------------------------------------------------------------------

export type Relay = (path: string) => Promise<'sent' | 'refused'>

/** Emails the site OWNER through the platform relay (kind `notification`, no `to`). Throws when worth retrying. */
export const relayToOwner: Relay = async (path) => {
  const email = { kind: 'notification', path }
  let status: number
  try {
    status = await siteKeyPost(jobRequestUrl(), '/emails', email)
  } catch (err) {
    if (err instanceof SiteKeyMissing) {
      if (config.localDev) console.log(localDevEmailLines(email, new URL(jobRequestUrl()).origin).join('\n'))
      else console.warn('[intelform] owner notification: no Site Key here, not sent')
      return config.localDev ? 'sent' : 'refused'
    }
    throw err
  }
  if (status === 200 || status === 202) return 'sent'
  if (status === 0 || status >= 500) throw new Error('The email relay did not answer. Trying again later.')
  // 401/422/429: retrying the same message won't help (429 = the site's hourly email limit).
  console.warn(`[intelform] owner notification: the platform answered ${status}`)
  return 'refused'
}

// ---------------------------------------------------------------------------
// The notify job
// ---------------------------------------------------------------------------

export interface NotifyDeps {
  relay?: Relay
  /** The mail provider (null = none); default from the owner's secrets. */
  mail?: MailProvider | null
  send?: typeof sendJob
  fetchImpl?: typeof fetch
  /** The site's own origin for absolute links in emails and payloads. */
  origin?: string | null
}

export interface NotifyOutcome {
  notified: 'owner' | 'team' | 'both' | 'none' | 'skipped'
  teamEmails: number
  confirmation: 'sent' | 'skipped' | 'capped' | 'no-provider' | 'invalid' | 'off'
  webhook: 'delivered' | 'failed' | 'retry-queued' | 'off' | 'skipped'
}

interface Loaded {
  id: string
  formId: string
  title: string
  settings: unknown
  version: number
  definition: unknown
  answers: unknown
  submittedAt: Date
}

async function loadResponse(db: PrismaClient, responseId: string): Promise<Loaded | null> {
  const r = await db.response.findUnique({
    where: { id: responseId },
    select: {
      id: true,
      formId: true,
      answers: true,
      submittedAt: true,
      formVersion: { select: { version: true, definition: true } },
      form: { select: { title: true, settings: true } },
    },
  })
  if (!r) return null
  return {
    id: r.id,
    formId: r.formId,
    title: r.form.title,
    settings: r.form.settings,
    version: r.formVersion.version,
    definition: r.formVersion.definition,
    answers: r.answers,
    submittedAt: r.submittedAt,
  }
}

export function readJobData(data: unknown): { responseId: string } {
  const id = (data as { responseId?: unknown } | null)?.responseId
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new DontRetry('The job has no valid response id.')
  return { responseId: id.toLowerCase() }
}

/** Teammates chosen in the form's settings who may still read responses: active, a real inbox, RESPONSE_READ. */
export async function notifiableTeammates(db: PrismaClient, ids: number[]): Promise<{ recipients: { id: number; email: string }[]; ownerChosen: boolean }> {
  if (!ids.length) return { recipients: [], ownerChosen: true }
  const users = await db.user.findMany({
    where: { id: { in: ids.slice(0, 50) }, status: 'active' },
    select: {
      id: true,
      email: true,
      platformOwnerId: true,
      roles: { select: { role: { select: { permissions: { select: { permission: { select: { codename: true } } }, take: 500 } } } }, take: 50 },
    },
    take: 50,
  })
  let ownerChosen = false
  const recipients: { id: number; email: string }[] = []
  for (const u of users) {
    // The owner's account holds a placeholder address: the relay reaches the owner instead.
    if (u.platformOwnerId) {
      ownerChosen = true
      continue
    }
    const codes = new Set<string>()
    for (const r of u.roles) for (const p of r.role.permissions) codes.add(p.permission.codename)
    if (!grants(codes, PERMISSIONS.RESPONSE_READ)) continue
    if (!EMAIL_RE.test(u.email) || u.email.toLowerCase().endsWith('.invalid')) continue
    recipients.push({ id: u.id, email: u.email })
  }
  return { recipients, ownerChosen }
}

async function appEmailSettings(db: PrismaClient): Promise<{ fromName: string; replyTo: string | null }> {
  const row = await db.intelformSettings.findUnique({ where: { id: 1 }, select: { appName: true, emailFromName: true, emailReplyTo: true } })
  return { fromName: row?.emailFromName?.trim() || row?.appName || 'IntelForm', replyTo: row?.emailReplyTo ?? null }
}

/**
 * `intelform-response-notify`: runs every step that isn't done yet. A step that fails in a
 * way worth retrying is thrown after the others ran (the job tries again; done steps are skipped).
 */
export async function runResponseNotify(db: PrismaClient, data: unknown, deps: NotifyDeps = {}): Promise<NotifyOutcome> {
  const { responseId } = readJobData(data)
  const out: NotifyOutcome = { notified: 'none', teamEmails: 0, confirmation: 'off', webhook: 'off' }
  const r = await loadResponse(db, responseId)
  // Deleted (by hand or retention) since the job was sent: nothing may go out.
  if (!r) return { notified: 'skipped', teamEmails: 0, confirmation: 'skipped', webhook: 'skipped' }

  const settings = readNotifySettings(r.settings)
  const def = readDefinition(r.definition)
  const answers = readAnswers(r.answers)
  const origin = deps.origin !== undefined ? deps.origin : config.siteUrl
  const relay = deps.relay ?? relayToOwner
  const needsMail = settings.notifyOnResponse || settings.confirmationEmail
  const app = needsMail ? await appEmailSettings(db) : { fromName: 'IntelForm', replyTo: null }
  const mail = deps.mail !== undefined ? deps.mail : needsMail ? mailProvider(app.fromName) : null

  const errors: Error[] = []
  const step = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      if (err instanceof DontRetry) throw err
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // 1. The team notification.
  if (settings.notifyOnResponse) {
    await step(async () => {
      out.notified = await notifyTeam(db, r, def, answers, settings, { relay, mail, origin })
    })
  }

  // 2. The respondent's confirmation.
  if (settings.confirmationEmail && settings.confirmationEmailFieldId) {
    await step(async () => {
      out.confirmation = await confirmRespondent(db, r, def, answers, settings, mail, app.replyTo)
    })
  }

  // 3. The webhook's first attempt.
  if (readWebhookConfig(r.settings).enabled) {
    await step(async () => {
      out.webhook = await firstWebhookAttempt(db, r, def, answers, origin, deps)
    })
  }

  if (errors.length) {
    // Words for the owner's Jobs tab; the done steps are skipped next time.
    throw new Error(errors.map((e) => e.message).join(' · ').slice(0, 400))
  }
  return out
}

async function notifyTeam(
  db: PrismaClient,
  r: Loaded,
  def: ReturnType<typeof readDefinition>,
  answers: Record<string, unknown>,
  settings: NotifySettings,
  deps: { relay: Relay; mail: MailProvider | null; origin: string | null },
): Promise<NotifyOutcome['notified']> {
  const { recipients, ownerChosen } = await notifiableTeammates(db, settings.notifyRecipients)
  const path = responsePath(r.formId, r.id)
  // Teammates need IntelForm's own email (a provider); without one the owner hears instead.
  const toOwner = ownerChosen || !deps.mail || !recipients.length
  if (toOwner) {
    const key = doneKey('notify', r.id, 'owner')
    if (!(await isDone(db, key))) {
      const sent = await deps.relay(path)
      if (sent === 'sent') await markDone(db, key)
    }
  }
  let teamSent = 0
  if (deps.mail && recipients.length) {
    const link = deps.origin ? `${deps.origin.replace(/\/+$/, '')}${path}` : path
    const text = `${r.title} has a new response.\n\n${answersAsText(def, answers, deps.origin)}\n\nOpen it in IntelForm:\n${link}\n`
    let failed: MailError | null = null
    for (const u of recipients) {
      const key = doneKey('notify', r.id, `u${u.id}`)
      if (await isDone(db, key)) {
        teamSent++
        continue
      }
      const m = normalizeMessage({ to: u.email, subject: `New response: ${r.title}`, text })
      if (!m) continue
      try {
        await deps.mail.send(m, { idempotencyKey: key })
        await markDone(db, key)
        teamSent++
      } catch (err) {
        if (!(err instanceof MailError)) throw err
        if (err.retryable) failed = err
        else console.warn(`[intelform] team notification refused by the mail provider (${err.message.slice(0, 80)})`)
      }
    }
    if (failed) throw new Error(`Team notification: ${failed.message}`)
  }
  if (toOwner && teamSent) return 'both'
  if (teamSent) return 'team'
  return toOwner ? 'owner' : 'none'
}

async function confirmRespondent(
  db: PrismaClient,
  r: Loaded,
  def: ReturnType<typeof readDefinition>,
  answers: Record<string, unknown>,
  settings: NotifySettings,
  mail: MailProvider | null,
  replyTo: string | null,
): Promise<NotifyOutcome['confirmation']> {
  const to = answers[settings.confirmationEmailFieldId!]
  if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) return 'invalid'
  if (!mail) return 'no-provider'
  const key = doneKey('confirm', r.id)
  if (await isDone(db, key)) return 'sent'
  // Counted once per response: a retry after a provider error isn't a second hit.
  const capKey = doneKey('confirm-counted', r.id)
  if (!(await isDone(db, capKey))) {
    const count = await hitWindow(db, `confirm:${r.formId}`, 3600)
    await markDone(db, capKey)
    if (count > CONFIRM_EMAIL_LIMIT) {
      console.warn('[intelform] confirmation email skipped: the form reached its hourly cap')
      await markDone(db, key)
      return 'capped'
    }
  }
  // Answers lose every link before they're piped into the owner's text.
  const piped = withoutLinks(answers) as Record<string, unknown>
  const subject = interpolate(settings.confirmationSubject, def, piped).replace(/[\r\n]+/g, ' ').trim() || r.title
  const text = interpolate(settings.confirmationBody, def, piped)
  const m = normalizeMessage({ to: to.trim(), subject, text, replyTo })
  if (!m) return 'invalid'
  try {
    await mail.send(m, { idempotencyKey: key })
  } catch (err) {
    if (err instanceof MailError && !err.retryable) {
      console.warn(`[intelform] confirmation email refused by the mail provider (${err.message.slice(0, 80)})`)
      await markDone(db, key)
      return 'skipped'
    }
    throw err instanceof MailError ? new Error(`Confirmation email: ${err.message}`) : err
  }
  await markDone(db, key)
  return 'sent'
}

async function firstWebhookAttempt(
  db: PrismaClient,
  r: Loaded,
  def: ReturnType<typeof readDefinition>,
  answers: Record<string, unknown>,
  origin: string | null,
  deps: NotifyDeps,
): Promise<NotifyOutcome['webhook']> {
  const key = doneKey('webhook', r.id)
  if ((await isDone(db, key)) || (await deliveredOnce(db, r.id))) return 'delivered'
  const payload = webhookPayload({ id: r.formId, title: r.title }, def, { id: r.id, submittedAt: r.submittedAt, version: r.version, answers }, origin)
  let result: DeliveryResult
  try {
    result = await deliverWebhook(db, r.formId, payload, { responseId: r.id, fetchImpl: deps.fetchImpl })
  } catch (err) {
    // The form went away or its webhook was turned off meanwhile: nothing to send.
    if (err instanceof WebhookError) return 'off'
    throw err
  }
  if (result.ok) {
    await markDone(db, key)
    return 'delivered'
  }
  if (!result.retryable) {
    await markDone(db, key)
    return 'failed'
  }
  // Worth another try: hand it to the webhook list, which retries on its own schedule.
  const send = deps.send ?? sendJob
  try {
    await send(jobRequestUrl(), WEBHOOK_LIST, { responseId: r.id }, {
      delay: WEBHOOK_RETRY_DELAY,
      key: `webhook-${r.id}`,
      label: clip(`Webhook retry · ${r.title || 'Untitled form'}`, 120),
    })
  } catch (err) {
    const code = err instanceof JobRejected ? err.code : 'error'
    console.warn(`[intelform] webhook retry not queued (${code})`)
    await markDone(db, key)
    return 'failed'
  }
  await markDone(db, key)
  return 'retry-queued'
}

// ---------------------------------------------------------------------------
// The webhook retry job
// ---------------------------------------------------------------------------

/**
 * `intelform-webhook-deliver`: one more attempt for a response's webhook, with the same
 * `webhook-id` (receivers dedupe on it). Throws to be tried again (network error, timeout,
 * 408/425/429/5xx), `DontRetry` when trying again can't help. Every attempt is in the log.
 */
export async function runWebhookDelivery(db: PrismaClient, data: unknown, deps: NotifyDeps = {}): Promise<'delivered' | 'off' | 'gone'> {
  const { responseId } = readJobData(data)
  const r = await loadResponse(db, responseId)
  // Response deleted (by hand or retention) since the job was sent: don't send its answers.
  if (!r) return 'gone'
  if (!readWebhookConfig(r.settings).enabled) return 'off'
  if (await deliveredOnce(db, r.id)) return 'delivered'
  const origin = deps.origin !== undefined ? deps.origin : config.siteUrl
  const def = readDefinition(r.definition)
  const answers = readAnswers(r.answers)
  const payload = webhookPayload({ id: r.formId, title: r.title }, def, { id: r.id, submittedAt: r.submittedAt, version: r.version, answers }, origin)
  let result: DeliveryResult
  try {
    result = await deliverWebhook(db, r.formId, payload, { responseId: r.id, fetchImpl: deps.fetchImpl })
  } catch (err) {
    if (err instanceof WebhookError) return 'off'
    throw err
  }
  if (result.ok) return 'delivered'
  if (result.retryable) throw new Error(`Webhook: ${result.error ?? 'failed'}. Trying again later.`)
  throw new DontRetry(`Webhook: ${result.error ?? 'failed'}.`)
}
