import type {PrismaClient} from '../../../generated/prisma/client';
import {RespondentError} from './errors';

/**
 * Fixed-window rate limits for the anonymous respondent routes, kept in `intelform_rate_limits`
 * (docs/agent/security.md "Limit what costs": the managed limiter has fixed kinds, so a feature
 * keeps its own bounded, indexed table). One upsert per check; keys never hold a raw IP (callers
 * pass the keyed hash from crypto.ts `ipKeyFor`).
 *
 * Expired windows are swept by whoever owns IntelForm's maintenance job (a `DELETE … WHERE
 * window_start + window_seconds < now()` on the `window_start` index).
 */
export type RawDb = Pick<PrismaClient, '$queryRaw'>;

/** Counts one hit in the current window and returns the window's count so far. */
export async function hit(db: RawDb, key: string, windowSeconds: number): Promise<number> {
  const rows = await db.$queryRaw<{count: number}[]>`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, date_bin(make_interval(secs => ${windowSeconds}::int), now(), 'epoch'), ${windowSeconds}::int, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count
  `;
  return Number(rows[0]?.count ?? 1);
}

/** Seconds until a window of this length ends (at least 1). */
export function retryAfter(windowSeconds: number, now = Date.now()): number {
  const ms = windowSeconds * 1000;
  return Math.max(1, Math.ceil((ms - (now % ms)) / 1000));
}

export function tooMany(retryAfterSeconds: number, message?: string): RespondentError {
  const wait = Math.max(1, Math.round(retryAfterSeconds));
  const human = wait < 90 ? 'a minute' : `${Math.ceil(wait / 60)} minutes`;
  return new RespondentError(429, 'rate_limited', message ?? `Too many attempts. Wait ${human} and try again.`, undefined, {
    'Retry-After': String(wait),
  });
}

/** Throws a 429 RespondentError once `limit` hits are exceeded in the current window. */
export async function rateLimit(db: RawDb, key: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
  const count = await hit(db, key, windowSeconds);
  if (count > limit) throw tooMany(retryAfter(windowSeconds), message);
}

/**
 * Gives one hit back in the current window, for limits that count only failures: take the hit
 * with `rateLimit` before the attempt (parallel attempts can't overshoot), release it on success.
 */
export async function release(db: RawDb, key: string, windowSeconds: number): Promise<void> {
  await db.$queryRaw`
    UPDATE intelform_rate_limits SET count = greatest(count - 1, 0)
    WHERE key = ${key} AND window_start = date_bin(make_interval(secs => ${windowSeconds}::int), now(), 'epoch')
    RETURNING 1
  `;
}
