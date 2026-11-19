import type { PrismaClient } from '../../../platform/db'
import { sweepLoop, type SweepResult } from '../housekeeping'

/**
 * Two small kinds of rows:
 *
 *   - `hitWindow`: a fixed-window count in intelform_rate_limits (the hourly confirmation-email cap
 *     per form), like the public routes' rate limits;
 *   - `isDone` / `doneSet` / `markDone` / `markAllDone`: "this step of this job already happened",
 *     so a job that runs again (at-least-once delivery, a retry after a later step failed) doesn't
 *     send the same email twice. Kept in intelform_done_markers (key, expires_at), DONE_SECONDS.
 *
 * Both are swept by the background jobs on an index range (`sweepWindows`, `sweepDoneMarkers`).
 * Keys are namespaced, ≤ 200 characters, never an email or an IP.
 *
 * For a week after the release that moved them (the old marker life), a marker the previous
 * version wrote while it was still running may be in intelform_rate_limits: `doneSet` looks there
 * too (a primary-key probe). After that, drop the first half of its UNION.
 */

/**
 * How long a marker lives. A queue row is retried for about 1.5 h (2, 5, 15, 60 minutes) and a
 * backlog can hold it longer; two days covers both with room to spare.
 */
export const DONE_SECONDS = 2 * 24 * 3600

/** Counts one hit in the current window and returns the window's count so far. */
export async function hitWindow(db: PrismaClient, key: string, windowSeconds: number): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, date_bin(make_interval(secs => ${windowSeconds}::int), now(), 'epoch'::timestamptz), ${windowSeconds}::int, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count
  `
  return Number(rows[0]?.count ?? 0)
}

export async function isDone(db: PrismaClient, key: string): Promise<boolean> {
  return (await doneSet(db, [key])).has(key)
}

/** Which of these markers exist: ONE query for a whole set (a job's recipients). */
export async function doneSet(db: PrismaClient, keys: readonly string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const list = [...keys]
  const rows = await db.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT key FROM intelform_rate_limits WHERE key = ANY(${list}::text[]) AND key LIKE 'job:%'
    UNION
    SELECT key FROM intelform_done_markers WHERE key = ANY(${list}::text[]) AND expires_at > now()
  `
  return new Set(rows.map((r) => r.key))
}

/** Writes several markers in ONE statement. */
export async function markAllDone(db: PrismaClient, keys: readonly string[]): Promise<void> {
  if (!keys.length) return
  await db.$executeRaw`
    INSERT INTO intelform_done_markers (key, expires_at)
    SELECT k, now() + make_interval(secs => ${DONE_SECONDS}::int) FROM unnest(${[...keys]}::text[]) AS k
    ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
  `
}

export async function markDone(db: PrismaClient, key: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO intelform_done_markers (key, expires_at)
    VALUES (${key}, now() + make_interval(secs => ${DONE_SECONDS}::int))
    ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
  `
}

/** Rows deleted per statement by the sweeps. */
export const SWEEP_BATCH = 5000

/**
 * Deletes rate-limit windows that ended over a minute ago (the minute covers a Worker clock a
 * little behind the database's), on the window-end index (intelform_window_end), oldest first, in
 * statements of `batch` rows, until a statement comes back short or the budget is spent. Returns
 * how many rows went. `sweepRateLimits` is the same with `more`.
 */
export async function sweepWindows(
  db: PrismaClient,
  opts: { batch?: number; budgetMs?: number; now?: () => number } = {},
): Promise<number> {
  return (await sweepRateLimits(db, { budgetMs: opts.budgetMs ?? 25_000, batch: opts.batch, now: opts.now })).rows
}

export async function sweepRateLimits(
  db: Pick<PrismaClient, '$executeRaw'>,
  opts: { budgetMs: number; batch?: number; now?: () => number },
): Promise<SweepResult> {
  const batch = opts.batch ?? SWEEP_BATCH
  return sweepLoop(
    () => db.$executeRaw`
      DELETE FROM intelform_rate_limits WHERE ctid = ANY(ARRAY(
        SELECT ctid FROM intelform_rate_limits
        WHERE intelform_window_end(window_start, window_seconds) < now() - interval '1 minute'
        ORDER BY intelform_window_end(window_start, window_seconds)
        LIMIT ${batch}
      ))
    `,
    batch,
    opts,
  )
}

/** Deletes expired done-markers on the expires_at index, like `sweepRateLimits`. */
export async function sweepDoneMarkers(
  db: Pick<PrismaClient, '$executeRaw'>,
  opts: { budgetMs: number; batch?: number; now?: () => number },
): Promise<SweepResult> {
  const batch = opts.batch ?? SWEEP_BATCH
  return sweepLoop(
    () => db.$executeRaw`
      DELETE FROM intelform_done_markers WHERE ctid = ANY(ARRAY(
        SELECT ctid FROM intelform_done_markers WHERE expires_at < now() ORDER BY expires_at LIMIT ${batch}
      ))
    `,
    batch,
    opts,
  )
}

export const doneKey = (step: string, responseId: string, extra?: string | number) =>
  `job:${step}:${responseId}${extra === undefined ? '' : `:${extra}`}`
