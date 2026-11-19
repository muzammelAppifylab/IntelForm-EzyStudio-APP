import { grants } from '../../../platform/auth/codenames'
import type { PrismaClient } from '../../../platform/db'
import { EMAIL_RE } from '../../../lib/intelform/form/types/registry'
import { PERMISSIONS } from '../../permissions'
import { readWebhookConfig, type WebhookFormRow } from '../webhooks'
import { mailProvider, type MailProvider } from './mailer'
import { doneKey, doneSet } from './markers'
import { readNotifySettings } from './settings'

/**
 * One drain run's shared reads (the "per-run context"). The drain works up to a few hundred
 * responses a run; most of what each one needs is the same for all of them or for every response
 * of a form, so it is read ONCE here instead of once per response:
 *
 *   - the app's email settings (sender name, reply-to) and the mail provider: once per run;
 *   - teammates (who may still read responses, and their address): once per user per run;
 *   - a batch's responses with their form version and form (settings, webhook secret): ONE query
 *     per claimed batch (`preload`);
 *   - every done-marker of that batch, and which of its webhooks already went out: ONE query.
 *
 * Nothing here is kept past the run (visitor data stays in the request scope), and what a response
 * used is dropped once it is worked.
 */

export type Relay = (path: string) => Promise<'sent' | 'refused' | 'limited'>

/**
 * Remembers, for one drain run, which forms' webhook endpoints keep failing. After `threshold`
 * retryable failures for a form, its other responses in that run skip the call (each would wait
 * out the 10 s timeout) and are tried again in a later run; a success closes it again. While a
 * form has a failure and a call in flight, its other responses wait for that call's answer (skip),
 * so a dead endpoint holds at most one connection of the run.
 */
export interface WebhookBreaker {
  isOpen(formId: string): boolean
  /** A call to this form's endpoint starts. */
  start(formId: string): void
  /** The call ended: `ok` true/false says whether the endpoint worked; null = no verdict. */
  record(formId: string, ok: boolean | null): void
}

/** Retryable webhook failures for one form in one drain run before its other responses skip the call. */
export const WEBHOOK_BREAKER_THRESHOLD = 3

export function webhookBreaker(threshold = WEBHOOK_BREAKER_THRESHOLD): WebhookBreaker {
  const failures = new Map<string, number>()
  const inFlight = new Map<string, number>()
  return {
    isOpen: (formId) => {
      const f = failures.get(formId) ?? 0
      return f >= threshold || (f > 0 && (inFlight.get(formId) ?? 0) > 0)
    },
    start: (formId) => void inFlight.set(formId, (inFlight.get(formId) ?? 0) + 1),
    record: (formId, ok) => {
      const n = (inFlight.get(formId) ?? 0) - 1
      if (n > 0) inFlight.set(formId, n)
      else inFlight.delete(formId)
      if (ok === true) failures.delete(formId)
      else if (ok === false) failures.set(formId, (failures.get(formId) ?? 0) + 1)
    },
  }
}

export interface Loaded {
  id: string
  formId: string
  title: string
  settings: unknown
  version: number
  definition: unknown
  answers: unknown
  submittedAt: Date
  /** The form's webhook settings and secret, shared by every response of the form in this run. */
  webhookForm: WebhookFormRow
}

export interface AppEmail {
  fromName: string
  replyTo: string | null
}

/** A chosen teammate: an address to email, the owner (reached through the relay), or neither. */
type TeamUser = { email: string } | 'owner' | null

export interface Team {
  recipients: { id: number; email: string }[]
  ownerChosen: boolean
}

export interface NotifyRun {
  readonly db: PrismaClient
  readonly relay: Relay
  readonly origin: string | null
  readonly breaker: WebhookBreaker
  readonly fetchImpl?: typeof fetch
  /** Reads these responses, their teammates and their done-markers in a few queries (skips known ones). */
  preload(ids: readonly string[]): Promise<void>
  /** The response (null = deleted), and forgets it: each response is worked once per run. */
  response(id: string): Loaded | null | undefined
  app(): Promise<AppEmail>
  mail(): Promise<MailProvider | null>
  team(ids: readonly number[]): Promise<Team>
  /** Which of these markers exist (from the preload when it covered this response). */
  done(responseId: string, keys: readonly string[]): Promise<Set<string>>
}

export interface RunOptions {
  relay: Relay
  /** The mail provider (null = none); default from the owner's secrets with the app's sender name. */
  mail?: MailProvider | null
  origin: string | null
  breaker?: WebhookBreaker
  fetchImpl?: typeof fetch
}

const MAX_RECIPIENTS = 50

/** The marker keys a response's steps read. Pure: from the response and its teammates. */
export function markerKeys(r: Loaded, team: Team | null): string[] {
  const s = readNotifySettings(r.settings)
  const keys: string[] = []
  if (s.notifyOnResponse) {
    keys.push(doneKey('notify-counted', r.id), doneKey('notify-digest', r.id), doneKey('notify', r.id, 'owner'))
    for (const u of team?.recipients ?? []) keys.push(doneKey('notify', r.id, `u${u.id}`))
  }
  if (s.confirmationEmail && s.confirmationEmailFieldId) {
    keys.push(doneKey('confirm', r.id), doneKey('confirm-counted', r.id), doneKey('confirm-capped', r.id))
  }
  if (readWebhookConfig(r.settings).enabled) keys.push(doneKey('webhook', r.id))
  return keys
}

export function notifyRun(db: PrismaClient, opts: RunOptions): NotifyRun {
  const responses = new Map<string, Loaded | null>()
  const forms = new Map<string, WebhookFormRow>()
  const users = new Map<number, TeamUser>()
  const doneKeys = new Set<string>()
  const markersRead = new Set<string>()
  let appP: Promise<AppEmail> | null = null
  let mailP: Promise<MailProvider | null> | null = null

  const app = () =>
    (appP ??= db.intelformSettings
      .findUnique({ where: { id: 1 }, select: { appName: true, emailFromName: true, emailReplyTo: true } })
      .then((row) => ({ fromName: row?.emailFromName?.trim() || row?.appName || 'IntelForm', replyTo: row?.emailReplyTo ?? null }))
      .catch((err) => {
        appP = null // a failed read is tried again by the next response, not remembered
        throw err
      }))

  const mail = () => {
    if (opts.mail !== undefined) return Promise.resolve(opts.mail)
    return (mailP ??= app().then(
      (a) => mailProvider(a.fromName),
      (err) => {
        mailP = null
        throw err
      },
    ))
  }

  async function loadUsers(ids: readonly number[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !users.has(id))
    if (!missing.length) return
    const rows = await db.user.findMany({
      where: { id: { in: missing }, status: 'active' },
      select: {
        id: true,
        email: true,
        platformOwnerId: true,
        roles: { select: { role: { select: { permissions: { select: { permission: { select: { codename: true } } }, take: 500 } } } }, take: 50 },
      },
      take: missing.length,
    })
    for (const id of missing) users.set(id, null)
    for (const u of rows) {
      // The owner's account holds a placeholder address: the relay reaches the owner instead.
      if (u.platformOwnerId) {
        users.set(u.id, 'owner')
        continue
      }
      const codes = new Set<string>()
      for (const r of u.roles) for (const p of r.role.permissions) codes.add(p.permission.codename)
      if (!grants(codes, PERMISSIONS.RESPONSE_READ)) continue
      if (!EMAIL_RE.test(u.email) || u.email.toLowerCase().endsWith('.invalid')) continue
      users.set(u.id, { email: u.email })
    }
  }

  function teamOf(ids: readonly number[]): Team {
    if (!ids.length) return { recipients: [], ownerChosen: true }
    let ownerChosen = false
    const recipients: { id: number; email: string }[] = []
    for (const id of ids.slice(0, MAX_RECIPIENTS)) {
      const u = users.get(id)
      if (u === 'owner') ownerChosen = true
      else if (u) recipients.push({ id, email: u.email })
    }
    return { recipients, ownerChosen }
  }

  async function team(ids: readonly number[]): Promise<Team> {
    await loadUsers(ids.slice(0, MAX_RECIPIENTS))
    return teamOf(ids)
  }

  async function readMarkers(keys: readonly string[], hookIds: readonly string[]): Promise<Set<string>> {
    if (!keys.length) return new Set()
    // At once: the markers (./markers.ts), and the webhooks already delivered (a run that died
    // after the delivery but before anything else never sends it twice).
    const [done, hooks] = await Promise.all([
      doneSet(db, keys),
      hookIds.length
        ? db.$queryRaw<{ id: string }[]>`
            SELECT DISTINCT response_id::text AS id FROM webhook_deliveries
            WHERE response_id = ANY(${[...hookIds]}::uuid[]) AND is_test = false AND error IS NULL
          `
        : [],
    ])
    for (const h of hooks) done.add(doneKey('webhook', h.id))
    return done
  }

  async function preload(ids: readonly string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !responses.has(id))
    if (missing.length) {
      const rows = await db.response.findMany({
        where: { id: { in: missing } },
        select: {
          id: true,
          formId: true,
          answers: true,
          submittedAt: true,
          formVersion: { select: { version: true, definition: true } },
          form: { select: { title: true, settings: true, webhookSecret: true } },
        },
        take: missing.length,
      })
      for (const id of missing) responses.set(id, null)
      for (const r of rows) {
        // One row per form for the whole run: a secret made on first use is seen by the rest.
        let wf = forms.get(r.formId)
        if (!wf) forms.set(r.formId, (wf = { settings: r.form.settings, webhookSecret: r.form.webhookSecret }))
        responses.set(r.id, {
          id: r.id,
          formId: r.formId,
          title: r.form.title,
          settings: r.form.settings,
          version: r.formVersion.version,
          definition: r.formVersion.definition,
          answers: r.answers,
          submittedAt: r.submittedAt,
          webhookForm: wf,
        })
      }
    }
    const todo = [...new Set(ids)].map((id) => responses.get(id)).filter((r): r is Loaded => !!r && !markersRead.has(r.id))
    if (!todo.length) return
    const teamIds: number[] = []
    let needMail = false
    for (const r of todo) {
      const s = readNotifySettings(r.settings)
      if (s.notifyOnResponse) teamIds.push(...s.notifyRecipients.slice(0, MAX_RECIPIENTS))
      if (s.notifyOnResponse || s.confirmationEmail) needMail = true
    }
    // Independent reads at once: teammates and the app's sender (the mail provider needs it).
    await Promise.all([loadUsers(teamIds), needMail ? app() : null])
    const keys: string[] = []
    const hookIds: string[] = []
    for (const r of todo) {
      const k = markerKeys(r, teamOf(readNotifySettings(r.settings).notifyRecipients))
      keys.push(...k)
      if (k.includes(doneKey('webhook', r.id))) hookIds.push(r.id)
    }
    for (const k of await readMarkers(keys, hookIds)) doneKeys.add(k)
    for (const r of todo) markersRead.add(r.id)
  }

  return {
    db,
    relay: opts.relay,
    origin: opts.origin,
    breaker: opts.breaker ?? webhookBreaker(),
    fetchImpl: opts.fetchImpl,
    preload,
    response(id) {
      const r = responses.get(id)
      responses.delete(id) // worked once; the answers are not kept for the rest of the run
      return r
    },
    app,
    mail,
    team,
    async done(responseId, keys) {
      if (markersRead.has(responseId)) {
        markersRead.delete(responseId)
        const out = new Set(keys.filter((k) => doneKeys.has(k)))
        for (const k of keys) doneKeys.delete(k)
        return out
      }
      return readMarkers(
        keys,
        keys.includes(doneKey('webhook', responseId)) ? [responseId] : [],
      )
    },
  }
}
