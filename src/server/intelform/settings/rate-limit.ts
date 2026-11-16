import type {PrismaClient} from '../../../platform/db';

/** The start of the fixed window `now` falls in. */
export function windowStart(now: number, windowSeconds: number): Date {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(now / size) * size);
}

/**
 * Counts one hit for `key` in a fixed window (`intelform_rate_limits`) and says whether it is
 * still within `limit`. Keys are built from ids, never from what a visitor typed.
 */
export async function hitRateLimit(db: PrismaClient, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const start = windowStart(Date.now(), windowSeconds);
  const rows = await db.$queryRaw<{count: number}[]>`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, ${start}, ${windowSeconds}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count`;
  return Number(rows[0]?.count ?? 1) <= limit;
}
