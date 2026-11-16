import { defineBackground, JobRejected, sendJob } from '../platform/background'
import { getDb, type PrismaClient } from '../platform/db'
import { deleteFile } from '../platform/files'
import { jobRequestUrl, runResponseNotify, runWebhookDelivery, sweepWindows } from './intelform/notify'
import { trimWebhookDeliveries } from './intelform/webhooks'
import { webhookDeliveryJob } from './intelform/builder/webhook-delivery'
import { clearPublicSiteCache } from './intelform/public-site/data'

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
 *                              sweep rate-limit windows and stale builder presence
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
  },
  'intelform-maintenance': async () => {
    await hourlyMaintenance(db())
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
/** Stop starting batches after this long, to leave room for the files and the recount. */
const RETENTION_BUDGET_MS = 35_000
/** Raw view/start events are kept this long (the 15-minute rollup in form_event_counts stays). */
export const EVENTS_KEEP_DAYS = 30
const EVENTS_BATCH = 10_000

const FILE_ID_RE = /\/__platform\/files\/([A-Za-z0-9_-]{1,128})(?:[/?#]|$)/

/** The platform file id inside a stored answer URL (`/__platform/files/<id>/<name>`), or null. */
export function fileIdOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = FILE_ID_RE.exec(url)
  return m ? m[1] : null
}

export interface RetentionResult {
  responses: number
  files: number
  events: number
  /** More responses are past the period than this run deleted. */
  more: boolean
}

/**
 * Deletes responses older than IntelForm settings `retentionDays` (null = keep forever), in
 * batches, oldest first, with their signature files (platform storage) and webhook log rows
 * (ON DELETE CASCADE). forms.response_count and last_response_at are recounted for the forms a
 * batch touched, under their row locks like the delete route, so a concurrent submit is counted
 * once. Also deletes raw form_events older than EVENTS_KEEP_DAYS.
 */
export async function applyRetention(
  client: PrismaClient,
  deps: { removeFile?: (id: string) => Promise<unknown>; now?: () => number } = {},
): Promise<RetentionResult> {
  const now = deps.now ?? Date.now
  const started = now()
  const out: RetentionResult = { responses: 0, files: 0, events: 0, more: false }

  const settings = await client.intelformSettings.findUnique({ where: { id: 1 }, select: { retentionDays: true } })
  const days = settings?.retentionDays ?? null
  if (days && days >= 1) {
    const removeFile = deps.removeFile ?? ((id: string) => deleteFile(jobRequestUrl(), id))
    for (let i = 0; i < RETENTION_MAX_BATCHES; i++) {
      if (now() - started > RETENTION_BUDGET_MS) {
        out.more = true
        break
      }
      const deleted = await client.$queryRaw<{ form_id: string; urls: string[] | null }[]>`
        DELETE FROM responses WHERE id IN (
          SELECT id FROM responses
          WHERE submitted_at < now() - make_interval(days => ${days}::int)
          ORDER BY submitted_at
          LIMIT ${RETENTION_BATCH}
        )
        RETURNING form_id::text AS form_id, ARRAY(
          SELECT v->>'url' FROM jsonb_each(CASE WHEN jsonb_typeof(answers) = 'object' THEN answers ELSE '{}'::jsonb END) e(k, v)
          WHERE jsonb_typeof(v) = 'object' AND v->>'url' LIKE '%/__platform/files/%'
        ) AS urls
      `
      out.responses += deleted.length
      // The rows are gone (that DELETE committed on its own): now their files. A file that
      // can't be removed now stays in storage; the answer that pointed at it is gone either way.
      const fileIds = [...new Set(deleted.flatMap((r) => (r.urls ?? []).map(fileIdOf).filter((id): id is string => !!id)))]
      for (const id of fileIds) {
        try {
          const res = (await removeFile(id)) as { ok?: boolean } | undefined
          if (!res || res.ok !== false) out.files++
        } catch {
          // no Site Key on this machine, or storage off: nothing to remove here
        }
      }
      const formIds = [...new Set(deleted.map((r) => r.form_id))].sort()
      if (formIds.length) await recountResponses(client, formIds)
      if (deleted.length < RETENTION_BATCH) break
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

async function recountResponses(client: PrismaClient, formIds: string[]): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM forms WHERE id = ANY(${formIds}::uuid[]) ORDER BY id FOR UPDATE`
    await tx.$executeRaw`
      UPDATE forms f SET
        response_count = (SELECT count(*)::int FROM responses r WHERE r.form_id = f.id),
        last_response_at = (SELECT max(submitted_at) FROM responses r WHERE r.form_id = f.id)
      WHERE f.id = ANY(${formIds}::uuid[])
    `
  })
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

export async function hourlyMaintenance(client: PrismaClient): Promise<Record<string, number>> {
  const closedForms = await closeExpiredForms(client)
  // A closed form leaves the public site's list (it filters closeAt anyway; this keeps it tidy).
  if (closedForms > 0) await clearPublicSiteCache().catch(() => undefined)
  return {
    closedForms,
    webhookDeliveries: await trimWebhookDeliveries(client),
    rateLimits: await sweepWindows(client),
    presence: await sweepPresence(client),
  }
}
