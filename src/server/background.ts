import { defineBackground, JobRejected, sendJob } from '../platform/background'
import { getDb, type PrismaClient } from '../platform/db'
import { jobRequestUrl, runResponseNotify, runWebhookDelivery, sweepWindows } from './intelform/notify'
import { trimWebhookDeliveries } from './intelform/webhooks'
import { webhookDeliveryJob } from './intelform/builder/webhook-delivery'
import { clearPublicSiteCache } from './intelform/public-site/data'
import { clearPublicFormCache } from './intelform/respondent/cache'
import { drainFileTrash, FILE_CLEANUP_LIST, fileCleanupJob, scheduleFileCleanup } from './intelform/uploads/trash'
import { EXPORTS_LIST, runExportJob, sweepExports } from './intelform/exports/job'

/**
 * This site's BACKGROUND JOBS: one handler per list (docs/agent/background-jobs.md).
 *
 *   send:      sendJob(c.req.url, 'booking-reminders', {bookingId}, {at, key: `remind-${id}`, label})
 *   schedule:  background.json  {"schedules": {"daily-summary": {"every": "day", "at": "07:00", "tz": "Europe/London"}}}
 *
 * A handler gets the job's data (JSON) and returns when done. Throw to try again later;
 * throw `DontRetry` (from ../platform/background) when trying again cannot help. It may run more
 * than once: make it safe to repeat. Load what you need by id from the Site Database here; never
 * put a whole record (or a secret) in the data.
 *
 * IntelForm's lists:
 *   intelform-response-notify  a new response: team notification, respondent confirmation, the
 *                              webhook's first attempt (sent by the submit route, `queueResponseJobs`)
 *   intelform-webhook-deliver  a webhook attempt worth retrying (the platform retries it)
 *   intelform-webhooks         the builder's "Send test" / "Resend" (one attempt, logged)
 *   intelform-retention        daily: responses past the retention period, old raw form events
 *   intelform-maintenance      hourly: close forms past their close date, trim the webhook log,
 *                              sweep rate-limit windows, stale builder presence, old hourly
 *                              counts and old exports; remove trashed files a send left behind
 *   intelform-file-cleanup     stored files (signatures) of deleted responses, a few at a time
 *   intelform-exports          builds a CSV / ZIP export in bounded parts (intelform/exports/job.ts)
 */

function db(): PrismaClient {
  const client = getDb()
  if (!client) throw new Error('The Site Database is off.') // tried again later
  return client
}

export const background = defineBackground({
  'intelform-response-notify': async (data) => {
    await runResponseNotify(db(), data)
  },
  'intelform-webhook-deliver': async (data) => {
    await runWebhookDelivery(db(), data)
  },
  'intelform-webhooks': webhookDeliveryJob,
  'intelform-retention': async (data, job) => {
    const result = await applyRetention(db())
    if (result.more) await continueLater('intelform-retention', data, job.scheduledFor)
    // Their signature files are in the file trash (the delete trigger): the cleanup job removes them.
    if (result.responses) await scheduleFileCleanup(jobRequestUrl())
  },
  'intelform-maintenance': async () => {
    await hourlyMaintenance(db())
  },
  [FILE_CLEANUP_LIST]: async (data) => {
    const step = Number((data as { step?: unknown } | null)?.step ?? 0)
    await fileCleanupJob(db(), jobRequestUrl(), Number.isSafeInteger(step) && step >= 0 ? step : 0)
  },
  [EXPORTS_LIST]: async (data) => {
    await runExportJob(db(), jobRequestUrl(), data)
  },
})

/** Big work in pieces: one more job for the rest, at most MAX_CONTINUATIONS a day. */
const MAX_CONTINUATIONS = 20
async function continueLater(list: string, data: unknown, scheduledFor: string): Promise<void> {
  const step = Number((data as { step?: unknown } | null)?.step ?? 0)
  const next = Number.isSafeInteger(step) && step >= 0 ? step + 1 : 1
  if (next > MAX_CONTINUATIONS) return
  try {
    await sendJob(jobRequestUrl(), list, { step: next }, {
      key: `${list}-${scheduledFor.slice(0, 10)}-${next}`,
      label: `Retention cleanup, part ${next + 1}`,
    })
  } catch (err) {
    // Tomorrow's run picks up the rest.
    console.warn(`[intelform] ${list}: next part not sent (${err instanceof JobRejected ? err.code : 'error'})`)
  }
}

// ---------------------------------------------------------------------------
// Retention (daily)
// ---------------------------------------------------------------------------

export const RETENTION_BATCH = 500
/** Batches per run: 10,000 responses, well inside the 60 s a run has. */
export const RETENTION_MAX_BATCHES = 20
/** Stop starting batches after this long (a run has 60 s). */
const RETENTION_BUDGET_MS = 35_000
/** Raw view/start events are kept this long (the 15-minute rollup in form_event_counts stays). */
export const EVENTS_KEEP_DAYS = 30
const EVENTS_BATCH = 10_000

export interface RetentionResult {
  responses: number
  events: number
  /** More responses are past the period than this run deleted. */
  more: boolean
}

/**
 * Deletes responses older than IntelForm settings `retentionDays` (null = keep forever), in
 * batches, oldest first. Each batch is ONE statement: it deletes the rows, takes them off their
 * forms' response_count (`GREATEST(response_count - n, 0)`) and moves last_response_at back to
 * the newest response that stays (index on form_id, submitted_at), so no form is ever counted,
 * and a submit landing at the same moment is counted once (the UPDATE holds the form row).
 * Webhook log rows go with them (ON DELETE CASCADE); their signature files go to the file
 * trash (the delete trigger) for the cleanup job. Also deletes raw form_events older than
 * EVENTS_KEEP_DAYS.
 */
export async function applyRetention(client: PrismaClient, deps: { now?: () => number } = {}): Promise<RetentionResult> {
  const now = deps.now ?? Date.now
  const started = now()
  const out: RetentionResult = { responses: 0, events: 0, more: false }

  const settings = await client.intelformSettings.findUnique({ where: { id: 1 }, select: { retentionDays: true } })
  const days = settings?.retentionDays ?? null
  if (days && days >= 1) {
    for (let i = 0; i < RETENTION_MAX_BATCHES; i++) {
      if (now() - started > RETENTION_BUDGET_MS) {
        out.more = true
        break
      }
      const [batch] = await client.$queryRaw<{ deleted: number }[]>`
        WITH gone AS (
          DELETE FROM responses WHERE id IN (
            SELECT id FROM responses
            WHERE submitted_at < now() - make_interval(days => ${days}::int)
            ORDER BY submitted_at
            LIMIT ${RETENTION_BATCH}
          )
          RETURNING form_id
        ),
        touched AS (SELECT form_id, count(*)::int AS n FROM gone GROUP BY form_id),
        counted AS (
          UPDATE forms f SET
            response_count = GREATEST(f.response_count - t.n, 0),
            last_response_at = (
              SELECT max(r.submitted_at) FROM responses r
              WHERE r.form_id = f.id AND r.submitted_at >= now() - make_interval(days => ${days}::int)
            )
          FROM touched t WHERE f.id = t.form_id
          RETURNING f.id
        )
        SELECT (SELECT count(*)::int FROM gone) AS deleted, (SELECT count(*)::int FROM counted) AS forms
      `
      const deleted = Number(batch?.deleted ?? 0)
      out.responses += deleted
      if (deleted < RETENTION_BATCH) break
      if (i === RETENTION_MAX_BATCHES - 1) out.more = true
    }
  }

  // Raw funnel events: a few bounded batches a day keep up with any normal traffic.
  for (let i = 0; i < 5 && now() - started < RETENTION_BUDGET_MS + 10_000; i++) {
    const n = await client.$executeRaw`
      DELETE FROM form_events WHERE id IN (
        SELECT id FROM form_events WHERE created_at < now() - make_interval(days => ${EVENTS_KEEP_DAYS}::int) LIMIT ${EVENTS_BATCH}
      )
    `
    out.events += n
    if (n < EVENTS_BATCH) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Maintenance (hourly)
// ---------------------------------------------------------------------------

/**
 * Flips Live forms past their close date (settings.closeAt) to Closed. The public routes check
 * the date themselves, so this only keeps the stored status (and the dashboard badge) right.
 */
export async function closeExpiredForms(client: PrismaClient): Promise<number> {
  return client.$executeRaw`
    UPDATE forms SET status = 'closed', updated_at = now()
    WHERE status = 'live'
      AND settings->>'closeAt' IS NOT NULL
      AND intelform_try_timestamptz(settings->>'closeAt') <= now()
  `
}

/** Builder presence rows nobody refreshed for an hour ("live" is 45 s). */
export async function sweepPresence(client: PrismaClient): Promise<number> {
  return client.$executeRaw`
    DELETE FROM form_presence WHERE (form_id, tab_id) IN (
      SELECT form_id, tab_id FROM form_presence WHERE seen_at < now() - interval '1 hour' LIMIT 5000
    )
  `
}

/** Hourly response counts older than anything the strip or "this week" reads. */
export async function sweepResponseHours(client: PrismaClient): Promise<number> {
  return client.$executeRaw`
    DELETE FROM form_response_hours WHERE (form_id, hour) IN (
      SELECT form_id, hour FROM form_response_hours WHERE hour < now() - interval '35 days' LIMIT 10000
    )
  `
}

export async function hourlyMaintenance(
  client: PrismaClient,
  deps: { drain?: typeof drainFileTrash } = {},
): Promise<Record<string, number>> {
  const closedForms = await closeExpiredForms(client)
  // A closed form leaves the public site's list and its cached public page.
  if (closedForms > 0) {
    await clearPublicSiteCache().catch(() => undefined)
    await clearPublicFormCache().catch(() => undefined)
  }
  const out = {
    closedForms,
    webhookDeliveries: await trimWebhookDeliveries(client),
    rateLimits: await sweepWindows(client, { budgetMs: 15_000 }),
    presence: await sweepPresence(client),
    responseHours: await sweepResponseHours(client),
    exports: await sweepExports(client),
  }
  // Files of deleted responses that a refused job send left behind.
  const drained = await (deps.drain ?? drainFileTrash)(client, jobRequestUrl(), { budgetMs: 15_000 })
  return { ...out, files: drained.removed }
}
