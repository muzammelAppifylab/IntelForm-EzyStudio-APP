import { sql, type Queryable } from '../db/client'
import { logger } from './logger'

/**
 * Transactional outbox (docs/research/04-backend-infra.md "Outbox and scheduled jobs").
 *
 * - `enqueue(tx, …)` writes the job in the caller's transaction: if the transaction rolls back
 *   the job never existed, and a crash after commit loses nothing.
 * - Workers claim due jobs with FOR UPDATE SKIP LOCKED, so several instances never run the
 *   same job twice. Up to 4 run at once.
 * - Wake-ups: a pg_notify sent inside the transaction (delivered on commit) and a microtask
 *   drain after enqueue start delivery at once; a 5 s poller picks up anything left over.
 * - Failures retry with exponential backoff until max_attempts, then stay as failed rows.
 * - Payloads hold secrets and personal data (invite and reset links, answers in notification
 *   emails and webhooks). Once a job is done or failed for good its payload is replaced by
 *   `redactPayload(...)`, so a dump or backup of `jobs` yields no usable link or answer. Nothing
 *   reads a finished job's payload (webhook Resend uses webhook_deliveries).
 */

export interface Job<P = unknown> {
  id: number
  kind: string
  payload: P
  attempts: number
  maxAttempts: number
}

export type JobHandler<P = any> = (payload: P, job: Job<P>) => Promise<void>

export interface EnqueueOptions {
  /** Default 3. Webhooks use 1 (no automatic retries, PRD). */
  maxAttempts?: number
  /** Delay before the first run, in seconds. */
  delaySeconds?: number
}

const CHANNEL = 'intelform_jobs'
const CONCURRENCY = 4
const POLL_MS = 5000
const LOCK_SECONDS = 120

const handlers = new Map<string, JobHandler>()

/** Non-sensitive ids a finished job keeps, to tell what it was for. Everything else is dropped. */
const KEEP_KEYS = ['formId', 'responseId'] as const

/**
 * What a done or permanently failed job keeps of its payload: `{ redacted: true }` plus the
 * form and response ids, when present. Same as the SQL in failAbandonedJobs and 0007_privacy.sql.
 */
export function redactPayload(payload: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { redacted: true }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const key of KEEP_KEYS) {
      const v = (payload as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.length <= 64) out[key] = v
    }
  }
  return out
}

export function registerJob<P>(kind: string, handler: JobHandler<P>): void {
  handlers.set(kind, handler as JobHandler)
}

export async function enqueue<P extends object>(tx: Queryable, kind: string, payload: P, opts: EnqueueOptions = {}): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO jobs (kind, payload, max_attempts, run_at)
    VALUES (${kind}, ${tx.json(payload as never)}, ${opts.maxAttempts ?? 3}, now() + make_interval(secs => ${opts.delaySeconds ?? 0}))
    RETURNING id
  `
  // Delivered to every listening instance when (and only if) the transaction commits.
  await tx`SELECT pg_notify(${CHANNEL}, ${kind})`
  if (started) queueMicrotask(() => void drain())
  return Number(row.id)
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

let warnedMissing = false
/** A missing table (42P01) means migrations haven't run: say so once instead of every 5 s. */
export function reportDbError(err: unknown, message: string): void {
  if ((err as { code?: string })?.code === '42P01') {
    if (!warnedMissing) logger.warn('The jobs tables are missing. Run `npm run db:migrate` (or set MIGRATE_ON_BOOT=1).')
    warnedMissing = true
    return
  }
  logger.error({ err }, message)
}

let started = false
let timer: NodeJS.Timeout | undefined
let unlisten: (() => Promise<void>) | undefined
let draining: Promise<number> | null = null
let again = false
const inFlight = new Set<Promise<void>>()

/** Claims and runs due jobs until none are left. Returns how many ran. Safe to call any time. */
export function drain(): Promise<number> {
  if (draining) {
    again = true
    return draining
  }
  draining = (async () => {
    let total = 0
    try {
      do {
        again = false
        for (;;) {
          const free = CONCURRENCY - inFlight.size
          if (free <= 0) {
            await Promise.race(inFlight)
            continue
          }
          const jobs = await claim(free)
          if (!jobs.length) break
          for (const job of jobs) {
            const p = run(job).finally(() => inFlight.delete(p))
            inFlight.add(p)
          }
          total += jobs.length
        }
        await Promise.all(inFlight)
      } while (again)
    } catch (err) {
      reportDbError(err, 'job drain failed')
    } finally {
      draining = null
    }
    return total
  })()
  return draining
}

interface JobRow {
  id: string
  kind: string
  payload: unknown
  attempts: number
  max_attempts: number
}

async function claim(limit: number): Promise<JobRow[]> {
  return sql<JobRow[]>`
    UPDATE jobs SET locked_until = now() + make_interval(secs => ${LOCK_SECONDS}), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE done_at IS NULL AND failed_at IS NULL AND run_at <= now()
        AND (locked_until IS NULL OR locked_until < now()) AND attempts < max_attempts
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, kind, payload, attempts, max_attempts
  `
}

async function run(row: JobRow): Promise<void> {
  const job: Job = { id: Number(row.id), kind: row.kind, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts }
  const handler = handlers.get(row.kind)
  try {
    if (!handler) throw new Error(`No handler registered for job kind "${row.kind}"`)
    await handler(row.payload, job)
    await sql`
      UPDATE jobs SET done_at = now(), locked_until = NULL, last_error = NULL, payload = ${sql.json(redactPayload(row.payload) as never)}
      WHERE id = ${row.id}
    `
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000)
    const final = row.attempts >= row.max_attempts
    // Backoff: 30 s, 2 min, 8 min … capped at 1 hour.
    const delay = Math.min(3600, 30 * 4 ** (row.attempts - 1))
    await sql`
      UPDATE jobs SET
        locked_until = NULL,
        last_error = ${message},
        failed_at = ${final ? sql`now()` : null},
        payload = ${final ? sql`${sql.json(redactPayload(row.payload) as never)}` : sql`payload`},
        run_at = ${final ? sql`run_at` : sql`now() + make_interval(secs => ${delay})`}
      WHERE id = ${row.id}
    `
    logger.warn({ jobId: job.id, kind: job.kind, attempt: row.attempts, final, err: message }, 'job failed')
  }
}

/** Starts the poller and the LISTEN wake-up. Called once by server/index.ts. */
export async function startJobs(): Promise<void> {
  if (started) return
  started = true
  timer = setInterval(() => void drain(), POLL_MS)
  timer.unref()
  try {
    const sub = await sql.listen(CHANNEL, () => void drain())
    unlisten = sub.unlisten
  } catch (err) {
    logger.warn({ err }, 'LISTEN unavailable; jobs run on the 5 s poller only')
  }
  void drain()
}

/** Stops taking new jobs and waits up to `timeoutMs` for running ones. */
export async function stopJobs(timeoutMs = 10_000): Promise<void> {
  started = false
  if (timer) clearInterval(timer)
  timer = undefined
  await unlisten?.().catch(() => {})
  unlisten = undefined
  const pending = [draining, ...inFlight].filter(Boolean)
  if (pending.length) {
    await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, timeoutMs).unref())])
  }
}

/**
 * A worker that dies mid-job leaves its lease to expire. Jobs with attempts left are claimed
 * again; one that already used its last attempt (every webhook: max 1) could never be claimed
 * nor purged. Mark those failed so they show up and age out. Called by hourly maintenance.
 */
export async function failAbandonedJobs(): Promise<number> {
  const rows = await sql`
    UPDATE jobs SET failed_at = now(), locked_until = NULL,
      last_error = COALESCE(last_error, 'The worker stopped while running this job'),
      payload = jsonb_build_object('redacted', true)
        || jsonb_strip_nulls(jsonb_build_object('formId', payload->'formId', 'responseId', payload->'responseId'))
    WHERE done_at IS NULL AND failed_at IS NULL AND attempts >= max_attempts
      AND locked_until IS NOT NULL AND locked_until < now()
  `
  return rows.count
}

/** Finished jobs older than 7 days and failed ones older than 30 days. */
export async function purgeJobs(): Promise<number> {
  const rows = await sql`
    DELETE FROM jobs
    WHERE (done_at IS NOT NULL AND done_at < now() - interval '7 days')
       OR (failed_at IS NOT NULL AND failed_at < now() - interval '30 days')
  `
  return rows.count
}
