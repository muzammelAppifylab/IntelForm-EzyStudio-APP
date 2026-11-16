import type { PrismaClient } from '../../../platform/db'

/**
 * Small counters kept in intelform_rate_limits (key, window_start, window_seconds, count):
 *
 *   - `hitWindow`: a fixed-window count (the hourly confirmation-email cap per form);
 *   - `isDone` / `markDone`: "this step of this job already happened", so a job that runs again
 *     (at-least-once delivery, a retry after a later step failed) doesn't send the same email
 *     twice. A marker lives a week; the hourly maintenance job sweeps ended windows.
 *
 * Keys are namespaced, ≤ 200 characters, never an email or an IP.
 */

const DONE_SECONDS = 7 * 24 * 3600

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
  const row = await db.intelformRateLimit.findFirst({ where: { key }, select: { key: true } })
  return !!row
}

export async function markDone(db: PrismaClient, key: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, now(), ${DONE_SECONDS}::int, 1)
    ON CONFLICT (key, window_start) DO NOTHING
  `
}

/** Deletes ended windows (and old done-markers), at most `limit` rows a call. */
export async function sweepWindows(db: PrismaClient, limit = 5000): Promise<number> {
  return db.$executeRaw`
    DELETE FROM intelform_rate_limits WHERE (key, window_start) IN (
      SELECT key, window_start FROM intelform_rate_limits
      WHERE window_start < now() - interval '1 hour'
        AND window_start + make_interval(secs => window_seconds) < now()
      LIMIT ${limit}
    )
  `
}

export const doneKey = (step: string, responseId: string, extra?: string | number) =>
  `job:${step}:${responseId}${extra === undefined ? '' : `:${extra}`}`
