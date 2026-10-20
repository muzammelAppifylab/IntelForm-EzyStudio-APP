import { sql } from '../db/client'
import { failAbandonedJobs, purgeJobs, reportDbError } from './jobs'
import { logger } from './logger'
import { purgeLoginAttempts, purgeRateLimits } from './rate-limit'
import { getSetting } from './settings'
import { trimWebhookDeliveries } from './webhooks'

/**
 * Periodic maintenance with lease rows in `scheduler`: every instance checks every 30 s, and
 * the one whose UPDATE moves next_run_at forward runs that tick. No cron needed.
 */

interface Task {
  name: string
  everySeconds: number
  run: () => Promise<unknown>
}

const TASKS: Task[] = [
  { name: 'close-forms', everySeconds: 60, run: closeExpiredForms },
  { name: 'maintenance', everySeconds: 3600, run: hourlyMaintenance },
  { name: 'form-events', everySeconds: 86400, run: purgeOldFormEvents },
]

const CHECK_MS = 30_000
let timer: NodeJS.Timeout | undefined
let running: Promise<void> | null = null

/** Claims the task's lease if due. True means this instance runs it now. */
async function claim(task: Task): Promise<boolean> {
  await sql`INSERT INTO scheduler (name, next_run_at) VALUES (${task.name}, now()) ON CONFLICT (name) DO NOTHING`
  const rows = await sql`
    UPDATE scheduler SET next_run_at = now() + make_interval(secs => ${task.everySeconds}), last_run_at = now()
    WHERE name = ${task.name} AND next_run_at <= now()
    RETURNING name
  `
  return rows.length > 0
}

export async function tick(): Promise<void> {
  for (const task of TASKS) {
    try {
      if (!(await claim(task))) continue
      const result = await task.run()
      await sql`UPDATE scheduler SET last_error = NULL WHERE name = ${task.name}`
      logger.debug({ task: task.name, result }, 'scheduled task done')
    } catch (err) {
      reportDbError(err, `scheduled task ${task.name} failed`)
      await sql`UPDATE scheduler SET last_error = ${String((err as Error)?.message ?? err).slice(0, 1000)} WHERE name = ${task.name}`.catch(() => {})
    }
  }
}

export function startScheduler(): void {
  if (timer) return
  const run = () => {
    if (running) return
    running = tick().finally(() => {
      running = null
    })
  }
  timer = setInterval(run, CHECK_MS)
  timer.unref()
  run()
}

export async function stopScheduler(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = undefined
  await running
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Every minute: flips Live forms past their close date to Closed. Public routes check the
 * date themselves, so this only keeps the stored status (and the dashboard badge) right.
 * The date lives in forms.settings.closeAt (ISO string, Agent D's shared/form/settings.ts).
 */
export async function closeExpiredForms(): Promise<number> {
  const rows = await sql`
    UPDATE forms SET status = 'closed', updated_at = now()
    WHERE status = 'live'
      AND settings ? 'closeAt'
      AND intelform_try_timestamptz(settings->>'closeAt') <= now()
  `
  return rows.count
}

const RETENTION_BATCH = 1000

/**
 * Deletes responses older than data.retentionDays in batches of 1000. Returns how many went.
 * forms.response_count and last_response_at are kept by the app (submit adds one, the
 * responses routes recount), so each batch recounts the forms it touched, locking their rows
 * first like the delete route does, so a concurrent submit is counted exactly once.
 */
export async function applyRetention(): Promise<number> {
  const { retentionDays } = await getSetting('data')
  if (!retentionDays || retentionDays < 1) return 0
  let total = 0
  for (;;) {
    const deleted = await sql<{ form_id: string }[]>`
      DELETE FROM responses WHERE id IN (
        SELECT id FROM responses
        WHERE submitted_at < now() - make_interval(days => ${retentionDays})
        LIMIT ${RETENTION_BATCH}
      )
      RETURNING form_id
    `
    total += deleted.count
    const formIds = [...new Set(deleted.map((r) => r.form_id))].sort()
    if (formIds.length) await recountResponses(formIds)
    if (deleted.count < RETENTION_BATCH) break
  }
  return total
}

async function recountResponses(formIds: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT id FROM forms WHERE id IN ${tx(formIds)} ORDER BY id FOR UPDATE`
    await tx`
      UPDATE forms f SET
        response_count = (SELECT count(*)::int FROM responses r WHERE r.form_id = f.id),
        last_response_at = (SELECT max(submitted_at) FROM responses r WHERE r.form_id = f.id)
      WHERE f.id IN ${tx(formIds)}
    `
  })
}

/** Every hour: expired sessions, invites and resets; old rate limits; finished jobs; webhook log; retention. */
export async function hourlyMaintenance(): Promise<Record<string, number>> {
  const abandonedJobs = await failAbandonedJobs()
  const sessions = (await sql`DELETE FROM sessions WHERE expires_at < now()`).count
  const invites = (await sql`DELETE FROM invites WHERE accepted_at IS NULL AND expires_at < now() - interval '1 day'`).count
  const resets = (await sql`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day' OR (used_at IS NOT NULL AND used_at < now() - interval '1 day')`).count
  return {
    abandonedJobs,
    sessions,
    invites,
    resets,
    rateLimits: await purgeRateLimits(),
    loginAttempts: await purgeLoginAttempts(),
    jobs: await purgeJobs(),
    webhookDeliveries: await trimWebhookDeliveries(),
    responses: await applyRetention(),
  }
}

const EVENTS_KEEP_DAYS = 30

/**
 * Daily: deletes raw form_events (views, starts) older than 30 days. Only runs once the
 * responses area's rollup table `form_event_counts` (Agent G, 0004) exists, so the funnel
 * history is never lost on an install where nothing has rolled the events up yet.
 * Deletes in batches of 10,000 to keep locks short.
 */
export async function purgeOldFormEvents(): Promise<number> {
  const [{ rollup }] = await sql<{ rollup: string | null }[]>`SELECT to_regclass('public.form_event_counts')::text AS rollup`
  if (!rollup) return 0
  let total = 0
  for (;;) {
    const rows = await sql`
      DELETE FROM form_events WHERE id IN (
        SELECT id FROM form_events WHERE created_at < now() - make_interval(days => ${EVENTS_KEEP_DAYS}) LIMIT 10000
      )
    `
    total += rows.count
    if (rows.count < 10000) break
  }
  return total
}
