import { defineBackground, JobRejected, sendJob } from '../platform/background'
import { getDb, type PrismaClient } from '../platform/db'
import { drainNotifyQueue, jobRequestUrl, runResponseNotify, runWebhookDelivery, sendOwnerDigests } from './intelform/notify'
import { sweepDoneMarkers, sweepRateLimits } from './intelform/notify/markers'
import { trimWebhookDeliveries } from './intelform/webhooks/deliver'
import { webhookDeliveryJob } from './intelform/builder/webhook-delivery'
import { clearPublicSiteCache } from './intelform/public-site/data'
import { clearPublicFormCache } from './intelform/respondent/cache'
import { drainFileTrash, fileCleanupJob, scheduleFileCleanup } from './intelform/uploads/trash'
import { failStaleExports, resendPendingExports, runExportJob, sweepExports } from './intelform/exports/job'
import { clearSummaryCache } from './intelform/responses/summary'
import { refreshSummaryRollups } from './intelform/summary'
import { clearContactsOverview } from './intelform/contacts/query'
import { syncFormCounts } from './intelform/forms/counts'
import { applyContactQueue } from './intelform/contacts/apply'
import { NOTIFY_LIST, wakeNotifyAt } from './intelform/notify/wake'
import { foldEventCounts, runSteps, sweepFormEvents, sweepResponseHours, type Step } from './intelform/housekeeping'

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
 * IntelForm's lists (every run stays inside the 60 s a run has; every sweep is on an index range,
 * in short statements, with its own time budget: ./intelform/housekeeping.ts):
 *   intelform-notify           woken by submits, never on a timetable: ONE keyed job a minute
 *                              however many responses arrive (notify/wake.ts), two minutes on. It
 *                              folds queued contacts, refreshes the counters of forms that got
 *                              responses, drains intelform_notify_queue (team notification,
 *                              respondent confirmation, webhook) and sweeps ended rate-limit
 *                              windows; a backlog adds up to 3 keyed continuations a minute (the
 *                              platform takes 10 new jobs a minute), a retry wakes it for its minute
 *   intelform-quarter          every 15 minutes: one statement says what waits (an idle site stops
 *                              there); the Summary rollups and counters of marked forms, exports and
 *                              notifications whose send was refused, queued contacts
 *   intelform-response-notify  older per-response jobs still waiting on the live site (none sent now)
 *   intelform-webhook-deliver  older webhook retry jobs still waiting (none sent now)
 *   intelform-webhooks         the builder's "Send test" / "Resend" (one attempt, logged)
 *   intelform-retention        hourly (at :30): responses past the retention period, then one
 *                              continuation a minute while there are more
 *   intelform-maintenance      hourly: close forms past their close date, the owner's digests,
 *                              sweep rate-limit windows, done-markers, raw form events (2 days),
 *                              the webhook log, old hourly counts (and fold old shards of them and
 *                              of the funnel rollup), presence, old exports; fail exports whose job
 *                              stopped; remove trashed files a send left behind
 *   intelform-file-cleanup     stored files (signatures) of deleted responses, a few at a time
 *   intelform-exports          builds a CSV / ZIP export in bounded parts (intelform/exports/job.ts)
 */

/** ISO minute, `YYYY-MM-DDTHH:MM`. */
const minuteOf = (t: number) => new Date(t).toISOString().slice(0, 16)

/** Sends one keyed job; a refusal is logged (the next scheduled run picks the work up). */
async function sendKeyed(list: string, data: Record<string, unknown>, opts: { key: string; label: string; at?: Date }): Promise<boolean> {
  try {
    await sendJob(jobRequestUrl(), list, data, opts)
    return true
  } catch (err) {
    console.warn(`[intelform] ${list}: continuation not sent (${err instanceof JobRejected ? err.code : 'error'})`)
    return false
  }
}

function db(): PrismaClient {
  const client = getDb()
  if (!client) throw new Error('The Site Database is off.') // tried again later
  return client
}

/** A continuation's number (0 = the scheduled run). */
function stepOf(data: unknown, name = 'step'): number {
  const n = Number((data as Record<string, unknown> | null)?.[name] ?? 0)
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

// ---------------------------------------------------------------------------
// The notify job (woken by submits) and the 15-minute run
// ---------------------------------------------------------------------------

/** What one notify run may spend (a run has 60 s). */
export const NOTIFY_RUN_BUDGET_MS = 50_000
/** The contacts rollup's share, before the notifications. */
export const CONTACTS_BUDGET_MS = 5_000
/** Ended rate-limit windows: a minute's worth is a few thousand rows. */
export const MINUTE_SWEEP_BUDGET_MS = 3_000
/** The drain always gets at least this. */
const MIN_DRAIN_MS = 10_000
/**
 * Extra runs a minute while the queue has a backlog: keyed `notify-<minute>-<k>`, so never
 * more than this many a minute, whatever runs at once. With the submit's one, retention's one and
 * the file cleanup's one, the site stays inside the platform's 10 added jobs a minute.
 */
export const MAX_MINUTE_CONTINUATIONS = 3
/** The 15-minute run's Summary share. */
export const ROLLUPS_BUDGET_MS = 20_000

export interface NotifyRunDeps {
  now?: () => number
  contacts?: typeof applyContactQueue
  sync?: typeof syncFormCounts
  drain?: typeof drainNotifyQueue
  sweep?: typeof sweepRateLimits
  send?: typeof sendKeyed
  /** When the next queued retry is due (ms), or null: none queued. */
  nextDue?: (client: PrismaClient) => Promise<number | null>
  wakeAt?: typeof wakeNotifyAt
}

/** The earliest `next_at` in the notify queue (its index), or null when it is empty. */
async function nextNotifyDue(client: PrismaClient): Promise<number | null> {
  const [row] = await client.$queryRaw<{at: Date | null}[]>`SELECT min(next_at) AS at FROM intelform_notify_queue`
  return row?.at ? new Date(row.at).getTime() : null
}

/**
 * One notify run, woken by the submits of a minute (`wakeNotifyJob`, ./intelform/notify/wake.ts),
 * never on a timetable: an idle site runs none. The first run of a minute (k = 0) folds the queued
 * contacts into `contacts` and refreshes the counters of the forms that got responses, each in its
 * own try/catch so neither skips the notifications; every run then drains the notify queue with
 * the rest of the budget. When the drain says more, the next continuation is sent
 * (k + 1 ≤ MAX_MINUTE_CONTINUATIONS; they only drain, and the queue's claims keep them apart).
 * When it is done but a failed response waits for its back-off, the job is woken for that minute.
 */
export async function notifyRun(client: PrismaClient, data: unknown, deps: NotifyRunDeps = {}): Promise<{ k: number; continued: boolean; woke: boolean }> {
  const now = deps.now ?? Date.now
  const started = now()
  const left = () => NOTIFY_RUN_BUDGET_MS - (now() - started)
  const k = Math.min(stepOf(data, 'k'), MAX_MINUTE_CONTINUATIONS)

  if (k === 0) {
    try {
      await (deps.contacts ?? applyContactQueue)(client, { budgetMs: CONTACTS_BUDGET_MS, now })
    } catch (err) {
      console.error(`[intelform] contacts not rolled up (${err instanceof Error ? err.name : 'error'})`)
    }
    try {
      await (deps.sync ?? syncFormCounts)(client)
    } catch (err) {
      console.error(`[intelform] form counts not refreshed (${err instanceof Error ? err.name : 'error'})`)
    }
  }
  // The drain's budget counts from the start of the run, so the steps before never push it past
  // the 60 s limit.
  const sweepMs = k === 0 ? MINUTE_SWEEP_BUDGET_MS : 0
  const drained = await (deps.drain ?? drainNotifyQueue)(client, jobRequestUrl(), { budgetMs: Math.max(MIN_DRAIN_MS, left() - sweepMs) })
  if (k === 0) {
    try {
      await (deps.sweep ?? sweepRateLimits)(client, { budgetMs: Math.max(500, Math.min(sweepMs, left())) })
    } catch (err) {
      console.error(`[intelform] rate-limit windows not swept (${err instanceof Error ? err.name : 'error'})`)
    }
  }
  let continued = false
  let woke = false
  if (drained.more && k < MAX_MINUTE_CONTINUATIONS) {
    const next = k + 1
    continued = await (deps.send ?? sendKeyed)(NOTIFY_LIST, { k: next }, {
      key: `notify-${minuteOf(now())}-${next}`,
      label: `IntelForm: catch up on notifications, part ${next + 1}`,
    })
  }
  if (!continued) {
    // Left in the queue (a retry after its back-off, or a backlog past this minute's runs): the
    // job for that minute. One indexed read; the 15-minute run is the safety net.
    const due = await (deps.nextDue ?? nextNotifyDue)(client).catch(() => null)
    if (due !== null) woke = await (deps.wakeAt ?? wakeNotifyAt)(jobRequestUrl(), due, now())
  }
  return { k, continued, woke }
}

export interface QuarterDeps {
  now?: () => number
  contacts?: typeof applyContactQueue
  sync?: typeof syncFormCounts
  exports?: typeof resendPendingExports
  rollups?: typeof refreshSummaryRollups
  drain?: typeof drainNotifyQueue
}

interface QuarterTodo {
  contacts: boolean
  counts: boolean
  summary: boolean
  exports: boolean
  notify: boolean
}

/** What the 15-minute run has to do: ONE statement of index probes (an idle site stops here). */
export async function quarterTodo(client: Pick<PrismaClient, '$queryRaw'>): Promise<QuarterTodo> {
  const [row] = await client.$queryRaw<QuarterTodo[]>`
    SELECT
      EXISTS (SELECT 1 FROM intelform_contact_queue) AS contacts,
      EXISTS (SELECT 1 FROM intelform_dirty_forms WHERE kind = 'c') AS counts,
      EXISTS (SELECT 1 FROM intelform_dirty_forms WHERE kind IN ('s', 'e')) AS summary,
      EXISTS (SELECT 1 FROM intelform_exports WHERE status = 'running' AND send_pending) AS exports,
      EXISTS (SELECT 1 FROM intelform_notify_queue WHERE next_at <= now()) AS notify
  `
  return row ?? { contacts: false, counts: false, summary: false, exports: false, notify: false }
}

/**
 * Every 15 minutes (`intelform-quarter`): the work no submit wakes, and a safety net for what a
 * refused send left. One statement says what is waiting; each step runs only when it has work,
 * each in its own try/catch: the Summary rollups of marked forms (responses older than a few
 * minutes, funnel events), the counters of forms that only got starts or deletes, exports whose
 * next part couldn't be sent, notifications whose wake-up was refused, queued contacts.
 */
export async function quarterRun(client: PrismaClient, deps: QuarterDeps = {}): Promise<QuarterTodo> {
  const now = deps.now ?? Date.now
  const started = now()
  const left = () => NOTIFY_RUN_BUDGET_MS - (now() - started)
  const todo = await quarterTodo(client)
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[intelform] ${name} not done (${err instanceof Error ? err.name : 'error'})`)
    }
  }
  if (todo.contacts) await step('contacts rollup', () => (deps.contacts ?? applyContactQueue)(client, { budgetMs: CONTACTS_BUDGET_MS, now }))
  if (todo.counts) await step('form counts', () => (deps.sync ?? syncFormCounts)(client))
  if (todo.exports) await step('pending exports', () => (deps.exports ?? resendPendingExports)(client, jobRequestUrl()))
  if (todo.notify) await step('notify drain', () => (deps.drain ?? drainNotifyQueue)(client, jobRequestUrl(), { budgetMs: Math.max(MIN_DRAIN_MS, Math.min(25_000, left() - ROLLUPS_BUDGET_MS)) }))
  if (todo.summary) await step('summary rollups', () => (deps.rollups ?? refreshSummaryRollups)(client, { budgetMs: Math.max(1_000, Math.min(ROLLUPS_BUDGET_MS, left() - 2_000)) }))
  return todo
}

export const background = defineBackground({
  'intelform-notify': async (data) => {
    await notifyRun(db(), data)
  },
  'intelform-quarter': async () => {
    await quarterRun(db())
  },
  'intelform-response-notify': async (data) => {
    await runResponseNotify(db(), data)
  },
  'intelform-webhook-deliver': async (data) => {
    await runWebhookDelivery(db(), data)
  },
  'intelform-webhooks': webhookDeliveryJob,
  'intelform-retention': async (data) => {
    await retentionRun(db(), data)
  },
  'intelform-maintenance': async () => {
    await hourlyMaintenance(db())
  },
  'intelform-file-cleanup': async (data) => {
    await fileCleanupJob(db(), jobRequestUrl(), stepOf(data))
  },
  'intelform-exports': async (data, job) => {
    // The last try that fails marks the export failed (it never stays "running").
    await runExportJob(db(), jobRequestUrl(), data, { lastTry: job.attempt >= job.maxAttempts })
  },
})

// ---------------------------------------------------------------------------
// Retention (hourly at :30, then a minute at a time while there are more)
// ---------------------------------------------------------------------------

export const RETENTION_BATCH = 500
/** Stop starting batches after this long (a run has 60 s). */
export const RETENTION_BUDGET_MS = 40_000
/**
 * Continuations per hourly run at most (one a minute: the next hour's run starts a new chain).
 * At 30k responses an hour a run deletes far more than an hour's worth, so a chain is short.
 */
export const RETENTION_MAX_CONTINUATIONS = 55

export interface RetentionResult {
  responses: number
  /** More responses are past the period than this run deleted. */
  more: boolean
}

async function clearRetentionCaches(): Promise<void> {
  await Promise.all([clearSummaryCache(), clearContactsOverview('soon')])
}

/**
 * Deletes responses older than IntelForm settings `retentionDays` (null = keep forever), in
 * batches, oldest first (the submitted_at index), until the batches come back short or
 * RETENTION_BUDGET_MS is spent. Each batch is ONE statement: the responses delete trigger takes
 * the rows off form_counts and form_response_hours, and `syncFormCounts` (notify and 15-minute runs) refreshes
 * forms.response_count and last_response_at for the forms the delete marked (no form row is locked here).
 * Webhook log rows go with them (ON DELETE CASCADE); their signature files go to the file
 * trash (the delete trigger) for the cleanup job, and exports that may hold them stop (the
 * exports trigger). When responses went, the cached Summary and contacts strip are cleared, as
 * the manual deletes do.
 *
 * The period is ONE app-wide setting (Settings > Data), not per form: it applies to every form.
 * Raw form events are the hourly job's (`sweepFormEvents`).
 */
export async function applyRetention(
  client: PrismaClient,
  deps: { now?: () => number; clearCaches?: () => Promise<void>; budgetMs?: number } = {},
): Promise<RetentionResult> {
  const now = deps.now ?? Date.now
  const started = now()
  const budget = deps.budgetMs ?? RETENTION_BUDGET_MS
  const out: RetentionResult = { responses: 0, more: false }

  const settings = await client.intelformSettings.findUnique({ where: { id: 1 }, select: { retentionDays: true } })
  const days = settings?.retentionDays ?? null
  if (!days || days < 1) return out
  for (;;) {
    const [batch] = await client.$queryRaw<{ deleted: number }[]>`
      WITH gone AS (
        DELETE FROM responses WHERE id IN (
          SELECT id FROM responses
          WHERE submitted_at < now() - make_interval(days => ${days}::int)
          ORDER BY submitted_at
          LIMIT ${RETENTION_BATCH}
        )
        RETURNING form_id
      )
      SELECT (SELECT count(*)::int FROM gone) AS deleted
    `
    const deleted = Number(batch?.deleted ?? 0)
    out.responses += deleted
    if (deleted < RETENTION_BATCH) break
    if (now() - started >= budget) {
      out.more = true
      break
    }
  }
  // Never show deleted responses (or the contacts they made) from the cache.
  if (out.responses > 0) await (deps.clearCaches ?? clearRetentionCaches)()
  return out
}

/**
 * One retention run, then the next part a minute later while there are more (keyed by that
 * minute: at most one added a minute, whatever runs at once). The file cleanup job
 * is asked for at the start and the end of a chain (it goes on by itself while files are left).
 */
export async function retentionRun(
  client: PrismaClient,
  data: unknown,
  deps: { now?: () => number; send?: typeof sendKeyed; cleanup?: typeof scheduleFileCleanup; apply?: typeof applyRetention } = {},
): Promise<RetentionResult & { continued: boolean }> {
  const now = deps.now ?? Date.now
  const step = stepOf(data)
  const result = await (deps.apply ?? applyRetention)(client, { now: deps.now })
  let continued = false
  if (result.more && step < RETENTION_MAX_CONTINUATIONS) {
    // A minute ahead: a job due sooner runs at once, and two sends for one minute are one job.
    const at = new Date(now() + 60_000)
    continued = await (deps.send ?? sendKeyed)('intelform-retention', { step: step + 1 }, {
      key: `intelform-retention-${minuteOf(at.getTime())}`,
      label: `Retention cleanup, part ${step + 2}`,
      at,
    })
  }
  // Their signature files are in the file trash (the delete trigger): the cleanup job removes them.
  if (result.responses && (step === 0 || !continued)) await (deps.cleanup ?? scheduleFileCleanup)(jobRequestUrl())
  return { ...result, continued }
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

/** What one hourly run may spend (a run has 60 s). */
export const MAINTENANCE_BUDGET_MS = 50_000

export interface MaintenanceDeps {
  drain?: typeof drainFileTrash
  digests?: typeof sendOwnerDigests
  now?: () => number
  totalMs?: number
}

/**
 * The hourly run: quick single statements first (they keep stored state right), then every
 * budgeted step with its own cap, in the order that matters most to people (digests, then the
 * tables that grow fastest). A step that throws is logged and the others still run; time left
 * over goes to the steps that still had work. Throws at the end when a step failed, naming the
 * steps (the list retries once; every step is safe to repeat).
 */
export async function hourlyMaintenance(client: PrismaClient, deps: MaintenanceDeps = {}): Promise<Record<string, number>> {
  const requestUrl = jobRequestUrl()
  const steps: Step[] = [
    {
      name: 'closedForms',
      capMs: 0,
      run: async () => {
        const closed = await closeExpiredForms(client)
        // A closed form leaves the public site's list and its cached public page.
        if (closed > 0) {
          await clearPublicSiteCache().catch(() => undefined)
          await clearPublicFormCache().catch(() => undefined)
        }
        return closed
      },
    },
    { name: 'presence', capMs: 0, run: () => sweepPresence(client) },
    { name: 'staleExports', capMs: 0, run: () => failStaleExports(client) },
    { name: 'exports', capMs: 0, run: () => sweepExports(client) },
    {
      name: 'digests',
      capMs: 10_000,
      run: async (budgetMs) => (await (deps.digests ?? sendOwnerDigests)(client, requestUrl, { budgetMs })).sent,
    },
    { name: 'rateLimits', capMs: 8_000, run: (budgetMs) => sweepRateLimits(client, { budgetMs }) },
    { name: 'formEvents', capMs: 8_000, run: (budgetMs) => sweepFormEvents(client, { budgetMs, now: deps.now }) },
    { name: 'doneMarkers', capMs: 4_000, run: (budgetMs) => sweepDoneMarkers(client, { budgetMs, now: deps.now }) },
    { name: 'webhookDeliveries', capMs: 5_000, run: (budgetMs) => trimWebhookDeliveries(client, { budgetMs, now: deps.now }) },
    { name: 'responseHours', capMs: 4_000, run: (budgetMs) => sweepResponseHours(client, { budgetMs, now: deps.now }) },
    { name: 'eventCounts', capMs: 4_000, run: (budgetMs) => foldEventCounts(client, { budgetMs, now: deps.now }) },
    {
      // Files of deleted responses that a refused job send left behind.
      name: 'files',
      capMs: 6_000,
      run: async (budgetMs) => {
        const r = await (deps.drain ?? drainFileTrash)(client, requestUrl, { budgetMs })
        return { rows: r.removed, more: r.more }
      },
    },
  ]
  const result = await runSteps(steps, { totalMs: deps.totalMs ?? MAINTENANCE_BUDGET_MS, now: deps.now })
  if (result.more.length) console.warn(`[intelform] maintenance: more next hour (${result.more.join(', ')})`)
  if (result.failed.length) throw new Error(`Maintenance steps failed: ${result.failed.join(', ')}. The others ran.`)
  return result.counts
}
