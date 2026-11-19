import { SiteKeyMissing, siteKeyPost } from '../../../platform/api'
import { DontRetry } from '../../../platform/background'
import { config } from '../../../platform/config'
import type { PrismaClient } from '../../../platform/db'
import { localDevEmailLines } from '../../../platform/local-dev'
import { interpolate } from '../../../lib/intelform/form/logic'
import { EMAIL_RE } from '../../../lib/intelform/form/types/registry'
import { deliverWebhook, readWebhookConfig, WebhookError, webhookPayload, type DeliveryResult } from '../webhooks'
import { answersAsText, readAnswers, readDefinition } from './answers'
import { hmacHex } from '../respondent/crypto'
import { withoutLinks } from './links'
import { MailError, normalizeMessage, type MailProvider } from './mailer'
import { DONE_SECONDS, doneKey, hitWindow, markAllDone, markDone } from './markers'
import { markerKeys, notifyRun, type Loaded, type NotifyRun, type Relay, type Team, type WebhookBreaker } from './run'
import { readNotifySettings, type NotifySettings } from './settings'
import { FIXED_LIMITS, FORM_LIMITS } from '../../../lib/intelform/spam'
import { recordAbuse, type ConfirmSkipReason } from '../abuse/alert'

export { WEBHOOK_BREAKER_THRESHOLD, webhookBreaker, type NotifyRun, type Relay, type WebhookBreaker } from './run'

/**
 * What a new response sets off (legacy server/respondent/notify.ts): the team notification, the
 * respondent's confirmation and the webhook, all in `runResponseNotify(db, {responseId})`.
 *
 * Who runs it (docs/agent/background-jobs.md): the submit route puts the response in
 * `intelform_notify_queue` in its own statement, and `drainNotifyQueue` (./queue.ts), run by a
 * schedule every minute, works through it with ONE per-run context (`./run.ts`: settings,
 * teammates, a batch's responses and markers read once). No background job is ever sent per
 * response: the platform takes only 10 new jobs a minute by default.
 *
 *   intelform-response-notify   old jobs already waiting on the live site (one per response)
 *                               still run this function and finish normally;
 *   intelform-webhook-deliver   old webhook retries already waiting still run `runWebhookDelivery`.
 *
 * The three steps run AT THE SAME TIME (each waits on its own outside call). Each is marked done
 * (`./markers.ts`) right after its send, so running the response again (a retry from the queue,
 * an at-least-once job) never sends the same email twice; a step that fails in a way worth
 * retrying (an email provider error, the webhook endpoint down) throws after the others finished,
 * and only it is tried again later.
 *
 * Email limits, per form per hour (`intelform_notify_hours`, one row per form per hour):
 *   - the team notification goes one by one for the first NOTIFY_EMAILS_PER_HOUR responses; the
 *     rest wait for ONE digest after the hour (`sendOwnerDigests`, ./digest.ts). The owner's are
 *     relayed by the platform, whose hourly limits are shared with sign-up codes and password
 *     resets: a busy form must never use them up. A relayed email the platform refuses for its
 *     limit (429) joins the digest instead of being lost;
 *   - confirmations stop after CONFIRM_EMAIL_LIMIT (abuse protection); the ones held back are
 *     counted and shown to the owner in the form's settings, and logged once per form per hour.
 */

/**
 * Confirmation emails per form per hour, by default (each form's Spam protection setting
 * `confirmPerHour`, src/lib/intelform/spam.ts): a form can't be turned into a bulk mailer. They go
 * through the OWNER's own mail provider (Resend / Postmark, ./mailer.ts), never the platform's
 * relay. The other confirmation limits (spam.ts FIXED_LIMITS and the site's `confirmPerDay`):
 *   - per address block: 3 an hour, every form together (counted by the submit's insert,
 *     respondent/submit.ts, which marks the response `confirm-skip-ip`);
 *   - per recipient: 1 a day from one form, 5 a day from every form together (the address is
 *     keyed with the site secret, never stored);
 *   - per site: `confirmPerDay` a day, every form together.
 * A confirmation held back by any of them is skipped (the response is saved), logged once per
 * form per hour with the reason, and the owner is told once an hour (../abuse/alert.ts).
 */
export const CONFIRM_EMAIL_LIMIT = FORM_LIMITS.confirmPerHour.default
/** Confirmation emails to ONE address per day, every form together. */
export const CONFIRM_PER_RECIPIENT_PER_DAY = FIXED_LIMITS.confirmPerRecipientPerDay
/** Responses per form per hour whose team notification goes one by one; the rest are in the hourly digest. */
export const NOTIFY_EMAILS_PER_HOUR = 10
/** Owner emails relayed one by one per hour for the whole site (every form); the rest are in the digest. */
export const OWNER_RELAY_PER_HOUR = 20
/** Team notification emails sent at once. */
const TEAM_SEND_CONCURRENCY = 5

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The address handlers use to reach the platform (a job has no request): the site's own. */
export function jobRequestUrl(): string {
  return config.siteUrl ?? 'http://localhost/'
}

/** The dashboard link to one response. */
export function responsePath(formId: string, responseId: string): string {
  return `/dashboard/forms/${encodeURIComponent(formId)}/responses?response=${encodeURIComponent(responseId)}`
}

/** True when a new response has anything to send (notification, confirmation or webhook). */
export function responseNeedsJobs(settings: unknown): boolean {
  const s = readNotifySettings(settings)
  return s.notifyOnResponse || (s.confirmationEmail && !!s.confirmationEmailFieldId) || readWebhookConfig(settings).enabled
}

// ---------------------------------------------------------------------------
// The platform relay (owner notification)
// ---------------------------------------------------------------------------

/**
 * Emails the site OWNER through the platform relay (kind `notification`, no `to`), reaching the
 * platform at `requestUrl` (default: the site's own address). `limited` = the platform's hourly
 * email limit (429): worth sending later (the digest). Throws when worth retrying soon.
 */
export function ownerRelay(requestUrl?: string | URL): Relay {
  return async (path) => {
    const url = requestUrl ?? jobRequestUrl()
    const email = { kind: 'notification', path }
    let status: number
    try {
      status = await siteKeyPost(url, '/emails', email)
    } catch (err) {
      if (err instanceof SiteKeyMissing) {
        if (config.localDev) console.log(localDevEmailLines(email, new URL(url).origin).join('\n'))
        else console.warn('[intelform] owner notification: no Site Key here, not sent')
        return config.localDev ? 'sent' : 'refused'
      }
      throw err
    }
    if (status === 200 || status === 202) return 'sent'
    if (status === 0 || status >= 500) throw new Error('The email relay did not answer. Trying again later.')
    if (status === 429) return 'limited'
    // 401/422: retrying the same message won't help.
    console.warn(`[intelform] owner notification: the platform answered ${status}`)
    return 'refused'
  }
}

/** The owner relay at the site's own address (jobs have no request). */
export const relayToOwner: Relay = ownerRelay()

// ---------------------------------------------------------------------------
// The notify job
// ---------------------------------------------------------------------------

export interface NotifyDeps {
  /** The drain run's shared context; when given, the options below are the run's, not these. */
  run?: NotifyRun
  relay?: Relay
  /** The mail provider (null = none); default from the owner's secrets. */
  mail?: MailProvider | null
  /** Shared by one drain run: skips endpoints that keep failing (see `webhookBreaker`). */
  webhookBreaker?: WebhookBreaker
  fetchImpl?: typeof fetch
  /** The site's own origin for absolute links in emails and payloads. */
  origin?: string | null
}

export interface NotifyOutcome {
  notified: 'owner' | 'team' | 'both' | 'none' | 'skipped' | 'digest'
  teamEmails: number
  confirmation: 'sent' | 'skipped' | 'capped' | 'no-provider' | 'invalid' | 'off'
  webhook: 'delivered' | 'failed' | 'off' | 'skipped'
}

/**
 * Only the webhook breaker held this response back (the endpoint keeps failing in this run):
 * the queue tries it again in a few minutes WITHOUT counting an attempt (it never reached the
 * endpoint). Any other failure counts.
 */
export class NotifyDeferred extends Error {}

export function readJobData(data: unknown): { responseId: string } {
  const id = (data as { responseId?: unknown } | null)?.responseId
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new DontRetry('The job has no valid response id.')
  return { responseId: id.toLowerCase() }
}

/** Teammates chosen in the form's settings who may still read responses: active, a real inbox, RESPONSE_READ. */
export async function notifiableTeammates(db: PrismaClient, ids: number[]): Promise<Team> {
  return notifyRun(db, { relay: relayToOwner, origin: null, mail: null }).team(ids)
}

/** The run to use: the drain's, or a one-off for an old per-response job. */
function runFor(db: PrismaClient, deps: NotifyDeps): NotifyRun {
  return (
    deps.run ??
    notifyRun(db, {
      relay: deps.relay ?? relayToOwner,
      mail: deps.mail,
      origin: deps.origin !== undefined ? deps.origin : config.siteUrl,
      breaker: deps.webhookBreaker,
      fetchImpl: deps.fetchImpl,
    })
  )
}

interface Counted {
  /** This response's team notification is in the hour's digest, not sent one by one. */
  digest: boolean
  /** The form reached its hourly confirmation cap: no confirmation for this response. */
  capped: boolean
}

/**
 * Counts this response against its form's hourly limits and marks it counted, in ONE statement
 * (so a retry never counts it twice, and the outcome is kept: a digested or capped response stays
 * so). Only the steps asked for are counted.
 */
async function countResponse(db: PrismaClient, r: Loaded, want: { notify: boolean; confirm: boolean }, confirmLimit: number): Promise<Counted> {
  const n = want.notify ? 1 : 0
  const c = want.confirm ? 1 : 0
  const rows = await db.$queryRaw<{ notified: number; confirmed: number; confirm_capped: number }[]>`
    WITH h AS (
      INSERT INTO intelform_notify_hours AS t (form_id, hour, notified, digest_pending, confirmed, confirm_capped)
      VALUES (${r.formId}::uuid, date_trunc('hour', now()), ${n}::int, CASE WHEN ${n}::int > ${NOTIFY_EMAILS_PER_HOUR}::int THEN 1 ELSE 0 END,
        ${c}::int, CASE WHEN ${c}::int > ${confirmLimit}::int THEN 1 ELSE 0 END)
      ON CONFLICT (form_id, hour) DO UPDATE SET
        notified = t.notified + EXCLUDED.notified,
        digest_pending = t.digest_pending
          + CASE WHEN EXCLUDED.notified > 0 AND t.notified + EXCLUDED.notified > ${NOTIFY_EMAILS_PER_HOUR}::int THEN 1 ELSE 0 END,
        confirmed = t.confirmed + EXCLUDED.confirmed,
        confirm_capped = t.confirm_capped
          + CASE WHEN EXCLUDED.confirmed > 0 AND t.confirmed + EXCLUDED.confirmed > ${confirmLimit}::int THEN 1 ELSE 0 END
      RETURNING notified, confirmed, confirm_capped
    ),
    k AS (
      INSERT INTO intelform_done_markers (key, expires_at)
      SELECT v.key, now() + make_interval(secs => ${DONE_SECONDS}::int)
      FROM h, LATERAL (VALUES
        (CASE WHEN ${n}::int = 1 THEN CASE WHEN h.notified > ${NOTIFY_EMAILS_PER_HOUR}::int THEN ${doneKey('notify-digest', r.id)} ELSE ${doneKey('notify-counted', r.id)} END END),
        (CASE WHEN ${c}::int = 1 THEN CASE WHEN h.confirmed > ${confirmLimit}::int THEN ${doneKey('confirm-capped', r.id)} ELSE ${doneKey('confirm-counted', r.id)} END END)
      ) AS v(key)
      WHERE v.key IS NOT NULL
      ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
    )
    SELECT notified, confirmed, confirm_capped FROM h
  `
  const row = rows[0]
  const out: Counted = {
    digest: !!n && Number(row?.notified ?? 0) > NOTIFY_EMAILS_PER_HOUR,
    capped: !!c && Number(row?.confirmed ?? 0) > confirmLimit,
  }
  // Logged once per form per hour (the first one held back), never per response.
  if (out.capped && Number(row?.confirm_capped ?? 0) === 1) {
    console.warn(`[intelform] confirmation emails: form ${r.formId} reached its hourly limit (${confirmLimit}); the rest of this hour's are not sent`)
  }
  return out
}

/**
 * A team notification that can't go now (the site's owner emails this hour, or the platform's
 * own limit) joins the hour's digest, and is marked done, in ONE statement.
 */
async function addToDigest(db: PrismaClient, r: Loaded, key: string): Promise<void> {
  await db.$executeRaw`
    WITH h AS (
      INSERT INTO intelform_notify_hours AS t (form_id, hour, digest_pending) VALUES (${r.formId}::uuid, date_trunc('hour', now()), 1)
      ON CONFLICT (form_id, hour) DO UPDATE SET digest_pending = t.digest_pending + 1
      RETURNING 1
    )
    INSERT INTO intelform_done_markers (key, expires_at)
    SELECT ${key}, now() + make_interval(secs => ${DONE_SECONDS}::int) FROM h
    ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
  `
}

/**
 * `intelform-response-notify`: runs every step that isn't done yet, at the same time. A step that
 * fails in a way worth retrying is thrown after the others finished (done steps are skipped next time).
 */
export async function runResponseNotify(db: PrismaClient, data: unknown, deps: NotifyDeps = {}): Promise<NotifyOutcome> {
  const { responseId } = readJobData(data)
  const run = runFor(db, deps)
  let r = run.response(responseId)
  if (r === undefined) {
    await run.preload([responseId])
    r = run.response(responseId)
  }
  // Deleted (by hand or retention) since it was queued: nothing may go out.
  if (!r) return { notified: 'skipped', teamEmails: 0, confirmation: 'skipped', webhook: 'skipped' }
  const resp = r

  const out: NotifyOutcome = { notified: 'none', teamEmails: 0, confirmation: 'off', webhook: 'off' }
  const settings = readNotifySettings(resp.settings)
  const def = readDefinition(resp.definition)
  const answers = readAnswers(resp.answers)
  const wantNotify = settings.notifyOnResponse
  const wantConfirm = settings.confirmationEmail && !!settings.confirmationEmailFieldId
  const wantHook = readWebhookConfig(resp.settings).enabled

  const [mail, team, app] = await Promise.all([
    wantNotify || wantConfirm ? run.mail() : null,
    wantNotify ? run.team(settings.notifyRecipients) : null,
    wantConfirm ? run.app() : null,
  ])
  const keys = markerKeys(resp, team)
  const done = await run.done(resp.id, keys)

  // The confirmation's address, checked before it is counted against the hourly cap.
  const to = wantConfirm ? answers[settings.confirmationEmailFieldId!] : undefined
  const confirmable = wantConfirm && typeof to === 'string' && EMAIL_RE.test(to.trim()) && !!mail

  // Count against the hourly limits once per response (one statement for both).
  const countNotify = wantNotify && !done.has(doneKey('notify-counted', resp.id)) && !done.has(doneKey('notify-digest', resp.id))
  const countConfirm =
    confirmable &&
    !done.has(doneKey('confirm', resp.id)) &&
    !done.has(doneKey('confirm-counted', resp.id)) &&
    !done.has(doneKey('confirm-capped', resp.id))
  // Held back at submit: the address block asked for too many confirmations this hour.
  const skippedAtSubmit = wantConfirm && done.has(doneKey('confirm-skip-ip', resp.id)) && !done.has(doneKey('confirm', resp.id))
  const countConfirmNow = countConfirm && !skippedAtSubmit
  const counted =
    countNotify || countConfirmNow
      ? await countResponse(db, resp, { notify: countNotify, confirm: countConfirmNow }, settings.confirmPerHour)
      : { digest: false, capped: false }
  const digest = done.has(doneKey('notify-digest', resp.id)) || (countNotify && counted.digest)
  let capped = skippedAtSubmit || done.has(doneKey('confirm-capped', resp.id)) || (countConfirmNow && counted.capped)
  let skipReason: ConfirmSkipReason | null = skippedAtSubmit ? 'ip' : countConfirmNow && counted.capped ? 'form' : null
  // Counted once per response, like the hourly cap (a retry finds 'confirm-counted' and skips this).
  if (countConfirmNow && !capped && config.jwtSecret && typeof to === 'string') {
    const who = (await hmacHex(config.jwtSecret, 'confirm-recipient', to.trim().toLowerCase())).slice(0, 40)
    const app = await run.app()
    // One address: once a day from this form, a few times a day from every form; then the site's day.
    const [fromForm, fromAll] = await Promise.all([
      hitWindow(db, `confirm-to:${resp.formId}:${who}`, 86_400),
      hitWindow(db, `confirm-to:${who}`, 86_400),
    ])
    if (fromForm > FIXED_LIMITS.confirmPerRecipientPerFormPerDay || fromAll > CONFIRM_PER_RECIPIENT_PER_DAY) skipReason = 'recipient'
    else if ((await hitWindow(db, 'confirm-site', 86_400)) > app.confirmPerDay) skipReason = 'site'
    if (skipReason) {
      await markDone(db, doneKey('confirm-capped', resp.id))
      capped = true
    }
  }
  if (skipReason) await recordAbuse(db, { kind: 'confirm-skipped', formId: resp.formId, reason: skipReason }, { run })

  const errors: Error[] = []
  let deferred = false
  let fatal: unknown = null
  const step = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      if (err instanceof DontRetry) fatal ??= err
      else if (err instanceof NotifyDeferred) deferred = true
      else errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  }

  await Promise.all([
    // 1. The team notification (or the hour's digest).
    wantNotify &&
      step(async () => {
        if (digest) {
          out.notified = 'digest'
          return
        }
        const res = await notifyTeam(run, resp, def, answers, team!, mail, done)
        out.notified = res.notified
        out.teamEmails = res.teamEmails
      }),
    // 2. The respondent's confirmation.
    wantConfirm &&
      step(async () => {
        if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) out.confirmation = 'invalid'
        else if (!mail) out.confirmation = 'no-provider'
        else if (done.has(doneKey('confirm', resp.id))) out.confirmation = 'sent'
        else if (capped) out.confirmation = 'capped'
        else out.confirmation = await confirmRespondent(db, resp, def, answers, settings, to.trim(), mail, app?.replyTo ?? null)
      }),
    // 3. The webhook.
    wantHook &&
      step(async () => {
        out.webhook = await webhookAttempt(run, resp, def, answers, done)
      }),
  ])

  if (fatal) throw fatal
  if (errors.length) {
    // Words for the owner's Jobs tab; the done steps are skipped next time.
    throw new Error(errors.map((e) => e.message).join(' · ').slice(0, 400))
  }
  if (deferred) throw new NotifyDeferred('Webhook: the endpoint keeps failing. Trying again later.')
  return out
}

async function notifyTeam(
  run: NotifyRun,
  r: Loaded,
  def: ReturnType<typeof readDefinition>,
  answers: Record<string, unknown>,
  team: Team,
  mail: MailProvider | null,
  done: Set<string>,
): Promise<{ notified: NotifyOutcome['notified']; teamEmails: number }> {
  const { db } = run
  const { recipients, ownerChosen } = team
  const path = responsePath(r.formId, r.id)
  // Teammates need IntelForm's own email (a provider); without one the owner hears instead.
  const toOwner = ownerChosen || !mail || !recipients.length
  let ownerDigest = false

  const owner = async () => {
    const key = doneKey('notify', r.id, 'owner')
    if (done.has(key)) return
    // The site's owner emails this hour (every form) are limited too: the relay's hourly limits are
    // shared with sign-up codes and password resets.
    if ((await hitWindow(db, 'notify-owner-relay', 3600)) > OWNER_RELAY_PER_HOUR) {
      await addToDigest(db, r, key)
      ownerDigest = true
      return
    }
    // check (preloaded) → send → mark, nothing in between.
    const sent = await run.relay(path)
    if (sent === 'sent' || sent === 'refused') await markDone(db, key)
    else {
      // The platform's limit: not lost, it joins the digest sent after the hour.
      await addToDigest(db, r, key)
      ownerDigest = true
    }
  }

  const teammates = async (): Promise<number> => {
    if (!mail || !recipients.length) return 0
    const link = run.origin ? `${run.origin.replace(/\/+$/, '')}${path}` : path
    const text = `${r.title} has a new response.\n\n${answersAsText(def, answers, run.origin, r.id)}\n\nOpen it in IntelForm:\n${link}\n`
    const keyOf = (u: { id: number }) => doneKey('notify', r.id, `u${u.id}`)
    let sent = recipients.filter((u) => done.has(keyOf(u))).length
    const todo = recipients.filter((u) => !done.has(keyOf(u)))
    let failed: MailError | null = null
    let unexpected: unknown = null
    const sentKeys: string[] = []
    for (let i = 0; i < todo.length; i += TEAM_SEND_CONCURRENCY) {
      await Promise.all(
        todo.slice(i, i + TEAM_SEND_CONCURRENCY).map(async (u) => {
          const key = keyOf(u)
          const m = normalizeMessage({ to: u.email, subject: `New response: ${r.title}`, text })
          if (!m) return
          try {
            await mail.send(m, { idempotencyKey: key })
            sentKeys.push(key)
          } catch (err) {
            if (!(err instanceof MailError)) unexpected ??= err
            else if (err.retryable) failed = err
            else console.warn(`[intelform] team notification refused by the mail provider (${err.message.slice(0, 80)})`)
          }
        }),
      )
    }
    // Markers first, so a retry never sends the ones that went out again.
    await markAllDone(db, sentKeys)
    sent += sentKeys.length
    if (unexpected) throw unexpected
    if (failed) throw new Error(`Team notification: ${(failed as MailError).message}`)
    return sent
  }

  const [, teamSent] = await Promise.all([toOwner ? owner() : null, teammates()])
  const notified: NotifyOutcome['notified'] =
    toOwner && teamSent ? 'both' : teamSent ? 'team' : toOwner ? (ownerDigest ? 'digest' : 'owner') : 'none'
  return { notified, teamEmails: teamSent }
}

/**
 * The confirmation's subject: the owner's own words or, when they are empty, the form's title.
 * Never a respondent's answer: a piped answer (`{field}`) shows its fallback or nothing, so a
 * stranger can't put their text in the subject line of an email sent from the owner's address.
 */
export function confirmationSubject(template: string, def: Parameters<typeof interpolate>[1], title: string): string {
  const own = interpolate(template, def, {}).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return (own || title).slice(0, 200)
}

async function confirmRespondent(
  db: PrismaClient,
  r: Loaded,
  def: ReturnType<typeof readDefinition>,
  answers: Record<string, unknown>,
  settings: NotifySettings,
  to: string,
  mail: MailProvider,
  replyTo: string | null,
): Promise<NotifyOutcome['confirmation']> {
  const key = doneKey('confirm', r.id)
  // Answers lose every link before they're piped into the owner's text (the body only).
  const piped = withoutLinks(answers) as Record<string, unknown>
  const subject = confirmationSubject(settings.confirmationSubject, def, r.title)
  const text = interpolate(settings.confirmationBody, def, piped)
  const m = normalizeMessage({ to, subject, text, replyTo })
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

async function webhookAttempt(
  run: NotifyRun,
  r: Loaded,
  def: ReturnType<typeof readDefinition>,
  answers: Record<string, unknown>,
  done: Set<string>,
): Promise<NotifyOutcome['webhook']> {
  const key = doneKey('webhook', r.id)
  // The marker, or a successful delivery in the log (both in the preloaded set).
  if (done.has(key)) return 'delivered'
  const { breaker } = run
  if (breaker.isOpen(r.formId)) throw new NotifyDeferred('Webhook: the endpoint keeps failing. Trying again later.')
  const payload = webhookPayload({ id: r.formId, title: r.title }, def, { id: r.id, submittedAt: r.submittedAt, version: r.version, answers }, run.origin)
  let result: DeliveryResult
  breaker.start(r.formId)
  try {
    result = await deliverWebhook(run.db, r.formId, payload, { responseId: r.id, fetchImpl: run.fetchImpl, form: r.webhookForm })
  } catch (err) {
    breaker.record(r.formId, null)
    // The form went away or its webhook was turned off meanwhile: nothing to send.
    if (err instanceof WebhookError) return 'off'
    throw err
  }
  breaker.record(r.formId, !result.retryable)
  // A success is in the delivery log (`error IS NULL`): that row is its marker.
  if (result.ok) return 'delivered'
  if (!result.retryable) {
    await markDone(run.db, key)
    return 'failed'
  }
  // Worth another try: not marked done, so the queue tries again after its back-off. Never a job per response.
  throw new Error(`Webhook: ${result.error ?? 'failed'}. Trying again later.`)
}

// ---------------------------------------------------------------------------
// The webhook retry job (old jobs only)
// ---------------------------------------------------------------------------

/**
 * `intelform-webhook-deliver`: retries sent before the notify queue existed (nothing sends to this
 * list any more; it stays so jobs already waiting on the live site finish). One more attempt for a response's webhook, with the same
 * `webhook-id` (receivers dedupe on it). Throws to be tried again (network error, timeout,
 * 408/425/429/5xx), `DontRetry` when trying again can't help. Every attempt is in the log.
 */
export async function runWebhookDelivery(db: PrismaClient, data: unknown, deps: NotifyDeps = {}): Promise<'delivered' | 'off' | 'gone'> {
  const { responseId } = readJobData(data)
  const run = runFor(db, { ...deps, mail: null })
  await run.preload([responseId])
  const r = run.response(responseId)
  // Response deleted (by hand or retention) since the job was sent: don't send its answers.
  if (!r) return 'gone'
  if (!readWebhookConfig(r.settings).enabled) return 'off'
  if ((await run.done(r.id, [doneKey('webhook', r.id)])).size) return 'delivered'
  const def = readDefinition(r.definition)
  const answers = readAnswers(r.answers)
  const payload = webhookPayload({ id: r.formId, title: r.title }, def, { id: r.id, submittedAt: r.submittedAt, version: r.version, answers }, run.origin)
  let result: DeliveryResult
  try {
    result = await deliverWebhook(db, r.formId, payload, { responseId: r.id, fetchImpl: run.fetchImpl, form: r.webhookForm })
  } catch (err) {
    if (err instanceof WebhookError) return 'off'
    throw err
  }
  if (result.ok) return 'delivered'
  if (result.retryable) throw new Error(`Webhook: ${result.error ?? 'failed'}. Trying again later.`)
  throw new DontRetry(`Webhook: ${result.error ?? 'failed'}.`)
}
