import { DontRetry } from '../../../platform/background'
import { config } from '../../../platform/config'
import type { PrismaClient } from '../../../platform/db'
import { NotifyDeferred, ownerRelay, runResponseNotify } from './notify'
import { notifyRun } from './run'

/**
 * The notify queue: responses whose notification, confirmation or webhook is still to go out.
 * The submit route inserts the row in the response's own statement; nothing sends a background
 * job per response (the platform takes 10 new jobs a minute by default, so a busy form lost
 * emails). Instead:
 *
 *   schedule (every minute):  drainNotifyQueue(db, url)  ~40 s of work, then returns `more`
 *                             (the job then starts a keyed continuation, up to 3 a minute)
 *
 * A run CLAIMS due rows a batch at a time in one statement (`next_at <= now()`, `FOR UPDATE SKIP
 * LOCKED`), which also pushes their `next_at` out by the back-off for their attempt (2, 5, 15, 60
 * minutes): two runs at once never take the same response, a run that dies leaves its rows to be
 * taken again after that, and a failed row needs no second write. Each batch's responses, settings,
 * teammates and done-markers are read in a few queries (`./run.ts`); a pool of DRAIN_CONCURRENCY
 * workers takes rows one by one (a slow one never holds up a whole batch) and runs each response's
 * steps at the same time (`runResponseNotify`); finished rows are deleted in groups. A row is let
 * go after DRAIN_MAX_ATTEMPTS (logged, counts only: never an address or an answer). A webhook
 * endpoint that is down is retried the same way, no retry job; responses the breaker held back
 * (never sent) go back for a few minutes without counting an attempt.
 *
 * Throughput: a response is ~4 short writes and 1–3 outside calls at once (relay or teammates'
 * mail for the first NOTIFY_EMAILS_PER_HOUR a form an hour, the confirmation up to its cap, the
 * webhook), ~0.3–0.6 s; 6 at once ≈ 10–15 responses a second, ~300 a run (MAX_PER_RUN), so the
 * every-minute run and its continuations work ~1,000 a minute.
 */

/** Rows claimed per statement (and read together: responses, teammates, markers). */
export const DRAIN_BATCH = 25
/**
 * Responses worked on at once. A Worker keeps ~6 outside connections open at a time (the rest
 * wait inside the runtime); a response's steps run together, but most need only 1–2 calls (owner
 * emails past the hourly limit go in the digest, confirmations stop at their cap), so 6 keeps
 * those connections busy without piling up waiting calls.
 */
export const DRAIN_CONCURRENCY = 6
/** Claims per response before it is let go (the first try and four retries). */
export const DRAIN_MAX_ATTEMPTS = 5
/**
 * Responses started per run. Each sends at most ~3 outside calls; 300 keeps a run's outside calls
 * (subrequests) well inside the Worker's limit of 1,000 per invocation.
 */
export const DRAIN_MAX_PER_RUN = 300
/**
 * Stop starting responses after this long. A run has 60 s; one in flight may take up to the
 * mail provider's 15 s timeout (its steps run at once, so not more).
 */
export const DRAIN_BUDGET_MS = 40_000
/** A response the webhook breaker held back is due again after this many minutes (no attempt counted). */
export const DRAIN_DEFER_MINUTES = 5

export interface NotifyDrainResult {
  /** Responses whose work finished (rows deleted). */
  done: number
  /** Responses that failed this run (kept for a retry, or let go after the last attempt). */
  failed: number
  /** Responses that could be taken now are still waiting: this run ran out of time or its quota. */
  more: boolean
}

/** One response's work; throws to be tried again later (`DontRetry`: never again; `NotifyDeferred`: later, uncounted). */
export type NotifyWork = (responseId: string) => Promise<unknown>

export interface DrainOptions {
  budgetMs?: number
  now?: () => number
  /** Tests: the per-response work (default: `runResponseNotify` with one shared run context). */
  work?: NotifyWork
  /** Tests: called with each claimed batch's ids before they are worked (default: the run's preload). */
  prepare?: (ids: string[]) => Promise<void>
  batch?: number
  concurrency?: number
  maxPerRun?: number
}

type QueueDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>

interface Claimed {
  response_id: string
  attempts: number
}

/**
 * Takes up to `limit` due responses, the longest due first, in ONE statement, and sets when each
 * may be taken again (its back-off: a failure needs no other write; a run that dies frees it then).
 */
async function claim(db: QueueDb, limit: number): Promise<Claimed[]> {
  const rows = await db.$queryRaw<Claimed[]>`
    UPDATE intelform_notify_queue q SET claimed_at = now(), attempts = q.attempts + 1,
      next_at = now() + make_interval(mins => CASE
        WHEN q.attempts + 1 <= 1 THEN 2 WHEN q.attempts + 1 = 2 THEN 5 WHEN q.attempts + 1 = 3 THEN 15 ELSE 60 END)
    WHERE q.response_id IN (
      SELECT response_id FROM intelform_notify_queue
      WHERE next_at <= now()
      ORDER BY next_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING q.response_id::text AS response_id, q.attempts
  `
  return rows.map((r) => ({ response_id: r.response_id, attempts: Number(r.attempts) }))
}

/** Works through the notify queue until it is empty, `budgetMs` is spent or `maxPerRun` started. */
export async function drainNotifyQueue(db: PrismaClient, requestUrl: string | URL, opts: DrainOptions = {}): Promise<NotifyDrainResult> {
  const now = opts.now ?? Date.now
  const until = now() + (opts.budgetMs ?? DRAIN_BUDGET_MS)
  const batch = Math.max(1, opts.batch ?? DRAIN_BATCH)
  const concurrency = Math.max(1, opts.concurrency ?? DRAIN_CONCURRENCY)
  const maxPerRun = Math.max(1, opts.maxPerRun ?? DRAIN_MAX_PER_RUN)
  let work: NotifyWork
  let prepare: ((ids: string[]) => Promise<void>) | undefined
  if (opts.work) {
    work = opts.work
    prepare = opts.prepare
  } else {
    const run = notifyRun(db, { relay: ownerRelay(requestUrl), origin: config.siteUrl })
    work = (responseId) => runResponseNotify(db, { responseId }, { run })
    prepare = opts.prepare ?? ((ids) => run.preload(ids))
  }

  const out: NotifyDrainResult = { done: 0, failed: 0, more: false }
  const buffer: Claimed[] = []
  const finished: string[] = []
  const unstarted: string[] = []
  const deferred: string[] = []
  let started = 0
  let claimedRows = 0
  let dropped = 0
  let retrying = 0
  let exhausted = false
  let fatal: unknown = null
  let claiming: Promise<void> | null = null
  let flushing: Promise<void> = Promise.resolve()

  const outOfRoom = () => now() >= until || claimedRows >= maxPerRun

  /** One claim at a time; workers that find the buffer empty wait on the same one. */
  const refill = () =>
    (claiming ??= (async () => {
      try {
        const take = Math.min(batch, maxPerRun - claimedRows)
        if (take <= 0) return
        const rows = await claim(db, take)
        claimedRows += rows.length
        if (rows.length < take) exhausted = true
        const ids = rows.filter((r) => r.attempts <= DRAIN_MAX_ATTEMPTS).map((r) => r.response_id)
        if (ids.length && prepare) {
          // A failed read here is not fatal: each response then reads what it needs itself.
          await prepare(ids).catch(() => {})
        }
        buffer.push(...rows)
      } catch (err) {
        fatal ??= err
        exhausted = true
      } finally {
        claiming = null
      }
    })())

  /** Deletes finished rows in groups (one statement each), off the workers' path. */
  const flush = (all = false) => {
    if (!finished.length || (!all && finished.length < batch)) return flushing
    const ids = finished.splice(0)
    // One failed delete must not skip the ones after it (each group is its own statement).
    flushing = flushing.catch(() => {}).then(async () => {
      await db.$executeRaw`DELETE FROM intelform_notify_queue WHERE response_id = ANY(${ids}::uuid[])`
    })
    return flushing
  }

  const worker = async () => {
    for (;;) {
      if (!buffer.length) {
        if (exhausted || fatal || outOfRoom()) return
        await refill()
        continue
      }
      const row = buffer.shift()!
      // A row claimed past its last attempt (a run died during it): let go without working it.
      if (row.attempts > DRAIN_MAX_ATTEMPTS) {
        finished.push(row.response_id)
        dropped++
        continue
      }
      if (now() >= until) {
        unstarted.push(row.response_id)
        continue
      }
      started++
      try {
        await work(row.response_id)
        finished.push(row.response_id)
        out.done++
      } catch (err) {
        if (err instanceof NotifyDeferred) deferred.push(row.response_id)
        else {
          out.failed++
          if (err instanceof DontRetry || row.attempts >= DRAIN_MAX_ATTEMPTS) {
            finished.push(row.response_id)
            dropped++
          } else retrying++ // its next_at is already after its back-off
        }
      }
      void flush().catch((e) => void (fatal ??= e))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  // Rows this run had no time for go back untouched; held-back ones in a few minutes, uncounted.
  // The resets run even when the last delete failed: a row this run never started keeps its attempt.
  const flushed = await flush(true).then(() => null, (e: unknown) => e)
  if (unstarted.length) {
    await db.$executeRaw`
      UPDATE intelform_notify_queue SET claimed_at = NULL, attempts = GREATEST(attempts - 1, 0), next_at = now()
      WHERE response_id = ANY(${unstarted}::uuid[])
    `
  }
  if (deferred.length) {
    await db.$executeRaw`
      UPDATE intelform_notify_queue SET claimed_at = NULL, attempts = GREATEST(attempts - 1, 0),
        next_at = now() + make_interval(mins => ${DRAIN_DEFER_MINUTES}::int)
      WHERE response_id = ANY(${deferred}::uuid[])
    `
  }
  if (retrying) console.warn(`[intelform] notify queue: ${retrying} response(s) failed, tried again later`)
  if (deferred.length) console.warn(`[intelform] notify queue: ${deferred.length} webhook(s) held back, the endpoint keeps failing`)
  if (dropped) console.error(`[intelform] notify queue: ${dropped} response(s) let go after ${DRAIN_MAX_ATTEMPTS} attempts`)
  if (flushed) fatal ??= flushed
  if (fatal) throw fatal
  out.more = unstarted.length > 0 || (!exhausted && outOfRoom())
  return out
}
