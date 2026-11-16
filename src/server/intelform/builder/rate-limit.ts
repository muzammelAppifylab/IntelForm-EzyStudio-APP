import type {Prisma} from '../../../generated/prisma/client';
import {BuilderError} from './errors';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Fixed-window rate limit in `intelform_rate_limits`: one upsert per check, holding across
 * Worker instances. Keys are namespaced by the caller (`webhook-test:<userId>`), never a raw IP.
 * Throws a 429 BuilderError (with Retry-After) once `limit` is passed in the current window.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
  const [row] = await db.$queryRaw<{count: number; retry: number}[]>`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, date_bin(make_interval(secs => ${windowSeconds}::int), now(), TIMESTAMPTZ 'epoch'), ${windowSeconds}::int, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count,
      ceil(extract(epoch FROM (window_start + make_interval(secs => window_seconds) - now())))::int AS retry`;
  if (row && row.count > limit) throw tooMany(row.retry, message);
}

export function tooMany(retryAfterSeconds: number, message?: string): BuilderError {
  const wait = Math.max(1, Math.round(retryAfterSeconds));
  const human = wait < 90 ? 'a minute' : `${Math.ceil(wait / 60)} minutes`;
  return new BuilderError(429, 'rate_limited', message ?? `Too many attempts. Wait ${human} and try again.`, undefined, undefined, {
    'Retry-After': String(wait),
  });
}
