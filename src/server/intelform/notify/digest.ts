import { config } from '../../../platform/config'
import type { PrismaClient } from '../../../platform/db'
import { MailError, normalizeMessage, type MailProvider } from './mailer'
import { doneKey, markAllDone } from './markers'
import { CONFIRM_EMAIL_LIMIT, NOTIFY_EMAILS_PER_HOUR, ownerRelay } from './notify'
import { notifyRun, type Relay } from './run'
import { readNotifySettings } from './settings'

/**
 * The hourly digest (`intelform_notify_hours`): a form's team notification goes one by one for the
 * first NOTIFY_EMAILS_PER_HOUR responses of an hour; the drain counts the rest (and owner emails
 * the platform refused for its limit) in `digest_pending`. After the hour, `sendOwnerDigests`
 * (the hourly job) sends what is pending:
 *
 *   - teammates: ONE email per form per hour, "N new responses on <form>", through the owner's
 *     mail provider (it can carry the number and the form's name);
 *   - the owner: ONE relayed email for the whole site (the relay sends only the platform's own
 *     "notification" email with a link, so one link to the form's responses, or to the forms
 *     list when several forms had a busy hour). One a site, not one a form: the relay's hourly
 *     limits are shared with sign-up codes and password resets.
 *
 * check → send → mark: a row's `digest_sent` is set to what was sent right after the send; a
 * refused relay (the platform's hourly limit) or a provider error leaves it pending for the next
 * hour's run. Responses counted after a digest went out (a drain that was mid-way at the turn of
 * the hour) go in the next run's digest.
 */

/** Rows (form-hours) read per run. */
const DIGEST_ROWS = 200
/** Hours rows kept (the builder shows the last 24 h); stuck pending ones are dropped after a week. */
const KEEP_HOURS_DAYS = 2
const TEAM_SEND_CONCURRENCY = 5

interface PendingRow {
  form_id: string
  hour: Date
  digest_pending: number
  digest_sent: number
  title: string
  settings: unknown
}

export interface DigestOptions {
  budgetMs: number
  now?: () => number
  /** Tests: the relay and the mail provider (default: the platform relay and the owner's provider). */
  relay?: Relay
  mail?: MailProvider | null
}

/** Sends the pending hourly digests (see above); returns how many emails went out. */
export async function sendOwnerDigests(db: PrismaClient, requestUrl: string | URL, opts: DigestOptions): Promise<{ sent: number }> {
  const now = opts.now ?? Date.now
  const until = now() + opts.budgetMs
  const run = notifyRun(db, { relay: opts.relay ?? ownerRelay(requestUrl), mail: opts.mail, origin: config.siteUrl })

  const rows = await db.$queryRaw<PendingRow[]>`
    SELECT h.form_id::text AS form_id, h.hour, h.digest_pending, h.digest_sent, f.title, f.settings
    FROM intelform_notify_hours h JOIN forms f ON f.id = h.form_id
    WHERE h.digest_pending > h.digest_sent AND h.hour < date_trunc('hour', now())
    ORDER BY h.hour, h.form_id
    LIMIT ${DIGEST_ROWS}
  `
  let sent = 0
  const complete: PendingRow[] = []
  const toOwner: PendingRow[] = []

  // Teammates: who each form's digest goes to (every chosen user read in one query).
  const settingsOf = new Map(rows.map((r) => [r, readNotifySettings(r.settings)]))
  const anyTeam = rows.some((r) => settingsOf.get(r)!.notifyOnResponse && settingsOf.get(r)!.notifyRecipients.length)
  const mail = anyTeam ? await run.mail() : null

  // Every chosen user read up front, 50 a query (the run caches them), never a query per form.
  const userIds = [...new Set(rows.flatMap((r) => (settingsOf.get(r)!.notifyOnResponse ? settingsOf.get(r)!.notifyRecipients : [])))]
  for (let i = 0; i < userIds.length; i += 50) await run.team(userIds.slice(i, i + 50))

  const teamWork: { row: PendingRow; recipients: { id: number; email: string }[] }[] = []
  for (const row of rows) {
    const s = settingsOf.get(row)!
    // Notifications turned off since: nothing to send, the count is closed.
    if (!s.notifyOnResponse) {
      complete.push(row)
      continue
    }
    const team = await run.team(s.notifyRecipients) // from the run's cache: no query
    if (team.ownerChosen || !mail || !team.recipients.length) toOwner.push(row)
    if (mail && team.recipients.length) teamWork.push({ row, recipients: team.recipients })
    else if (!toOwner.includes(row)) complete.push(row)
  }

  // Teammates: one email per form-hour each, markers so a rerun never sends one twice.
  const teamDone = new Set<PendingRow>()
  if (mail && teamWork.length) {
    const keyOf = (row: PendingRow, id: number) => doneKey('digest', row.form_id, `${row.hour.getTime() / 1000}:${row.digest_pending}:u${id}`)
    const allKeys = teamWork.flatMap((t) => t.recipients.map((u) => keyOf(t.row, u.id)))
    const already = await run.done('', allKeys)
    for (const t of teamWork) {
      if (now() >= until) break
      const n = t.row.digest_pending - t.row.digest_sent
      const path = `/dashboard/forms/${encodeURIComponent(t.row.form_id)}/responses`
      const link = config.siteUrl ? `${config.siteUrl.replace(/\/+$/, '')}${path}` : path
      const hourText = t.row.hour.toISOString().slice(0, 13).replace('T', ' ') + ':00 UTC'
      const text =
        `${t.row.title} had ${n} new response${n === 1 ? '' : 's'} in the hour from ${hourText} that weren't emailed one by one ` +
        `(only the first ${NOTIFY_EMAILS_PER_HOUR} an hour are).\n\nSee them in IntelForm:\n${link}\n`
      let retry = false
      const sentKeys: string[] = []
      const todo = t.recipients.filter((u) => !already.has(keyOf(t.row, u.id)))
      for (let i = 0; i < todo.length; i += TEAM_SEND_CONCURRENCY) {
        await Promise.all(
          todo.slice(i, i + TEAM_SEND_CONCURRENCY).map(async (u) => {
            const key = keyOf(t.row, u.id)
            const m = normalizeMessage({ to: u.email, subject: `${n} new response${n === 1 ? '' : 's'}: ${t.row.title}`, text })
            if (!m) return
            try {
              await mail.send(m, { idempotencyKey: key })
              sentKeys.push(key)
            } catch (err) {
              if (err instanceof MailError && !err.retryable) {
                console.warn(`[intelform] digest refused by the mail provider (${err.message.slice(0, 80)})`)
              } else retry = true
            }
          }),
        )
      }
      await markAllDone(db, sentKeys)
      sent += sentKeys.length
      if (!retry) teamDone.add(t.row)
    }
  }
  for (const t of teamWork) if (teamDone.has(t.row) && !toOwner.includes(t.row)) complete.push(t.row)

  // The owner: ONE relayed email for every form that had a busy hour.
  if (toOwner.length && now() < until) {
    const forms = new Set(toOwner.map((r) => r.form_id))
    const path = forms.size === 1 ? `/dashboard/forms/${encodeURIComponent(toOwner[0]!.form_id)}/responses` : '/dashboard/forms/'
    let answer: Awaited<ReturnType<Relay>> | 'failed'
    try {
      answer = await run.relay(path)
    } catch {
      answer = 'failed' // the relay didn't answer: next hour
    }
    if (answer === 'sent') sent++
    if (answer === 'sent' || answer === 'refused') {
      // A team part still to retry keeps the row pending; its owner part goes again then (rare).
      for (const r of toOwner) if (!teamWork.some((t) => t.row === r) || teamDone.has(r)) complete.push(r)
    } else if (answer === 'limited') console.warn('[intelform] notification digest: the platform’s hourly email limit, tried again next hour')
  }

  // Mark what went out, right after the sends (one statement).
  if (complete.length) {
    await db.$executeRaw`
      UPDATE intelform_notify_hours h SET digest_sent = GREATEST(h.digest_sent, v.pending)
      FROM unnest(${complete.map((r) => r.form_id)}::uuid[], ${complete.map((r) => r.hour)}::timestamptz[], ${complete.map((r) => r.digest_pending)}::int[])
        AS v(form_id, hour, pending)
      WHERE h.form_id = v.form_id AND h.hour = v.hour
    `
  }

  // Old hours go (bounded): the builder shows only the last 24 h.
  await db.$executeRaw`
    DELETE FROM intelform_notify_hours WHERE (form_id, hour) IN (
      SELECT form_id, hour FROM intelform_notify_hours
      WHERE hour < now() - make_interval(days => ${KEEP_HOURS_DAYS}::int)
        AND (digest_pending <= digest_sent OR hour < now() - interval '7 days')
      LIMIT 5000
    )
  `
  return { sent }
}

export interface NotifyStats {
  /** Confirmations the hourly cap held back in the last 24 hours. */
  cappedConfirmations: number
  /** Responses whose team notification went in an hourly digest in the last 24 hours. */
  digested: number
  confirmLimit: number
  notifyLimit: number
}

/** The form's notification numbers for its settings (null = no such form). One query. */
export async function notifyStats(db: PrismaClient, formId: string): Promise<NotifyStats | null> {
  const rows = await db.$queryRaw<{ capped: number; digested: number }[]>`
    SELECT coalesce(sum(h.confirm_capped), 0)::int AS capped, coalesce(sum(h.digest_pending), 0)::int AS digested
    FROM forms f LEFT JOIN intelform_notify_hours h ON h.form_id = f.id AND h.hour > now() - interval '24 hours'
    WHERE f.id = ${formId}::uuid
    GROUP BY f.id
  `
  const row = rows[0]
  if (!row) return null
  return {
    cappedConfirmations: Number(row.capped),
    digested: Number(row.digested),
    confirmLimit: CONFIRM_EMAIL_LIMIT,
    notifyLimit: NOTIFY_EMAILS_PER_HOUR,
  }
}
