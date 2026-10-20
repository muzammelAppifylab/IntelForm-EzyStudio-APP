import { sql } from '../db/client'
import { ApiError } from './errors'

/**
 * Fixed-window rate limit kept in Postgres (UNLOGGED rate_limits), so it holds across restarts
 * and across instances. One upsert per check. Throws a 429 ApiError once `limit` is exceeded
 * within the current window of `windowSeconds`.
 *
 * Keys are namespaced by the caller, e.g. `login:ip:<ipHash>`. Never put a raw IP in a key.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
  const count = await hit(key, windowSeconds)
  if (count > limit) {
    const [{ retry }] = await sql<{ retry: number }[]>`
      SELECT ceil(extract(epoch FROM (date_bin(make_interval(secs => ${windowSeconds}), now(), 'epoch') + make_interval(secs => ${windowSeconds}) - now())))::int AS retry
    `
    throw tooMany(retry, message)
  }
}

/** Counts one hit and returns the window's count so far. */
export async function hit(key: string, windowSeconds: number): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, date_bin(make_interval(secs => ${windowSeconds}), now(), 'epoch'), ${windowSeconds}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count
  `
  return row.count
}

export function tooMany(retryAfterSeconds: number, message?: string): ApiError {
  const wait = Math.max(1, Math.round(retryAfterSeconds))
  const human = wait < 90 ? 'a minute' : `${Math.ceil(wait / 60)} minutes`
  return new ApiError(429, 'rate_limited', message ?? `Too many attempts. Wait ${human} and try again.`, undefined, {
    'Retry-After': String(wait),
  })
}

/** Deletes windows that have ended. Called by the hourly maintenance task. */
export async function purgeRateLimits(): Promise<number> {
  const rows = await sql`DELETE FROM rate_limits WHERE window_start + make_interval(secs => window_seconds) < now()`
  return rows.count
}

// ---------------------------------------------------------------------------
// Login backoff (per account, A2 / B3)
// ---------------------------------------------------------------------------

const FREE_FAILURES = 5
const MAX_LOCK_MINUTES = 15

/** Throws 429 while the email is in backoff. Same answer whether or not the account exists. */
export async function assertLoginAllowed(email: string): Promise<void> {
  const [row] = await sql<{ wait: number }[]>`
    SELECT ceil(extract(epoch FROM locked_until - now()))::int AS wait
    FROM login_attempts WHERE email = ${email} AND locked_until > now()
  `
  if (row) throw tooMany(row.wait, `Too many failed attempts. Wait ${row.wait < 90 ? 'a minute' : `${Math.ceil(row.wait / 60)} minutes`} and try again.`)
}

/** Records a failure: after 5, lock for 1, 2, 4, 8, 15, 15 … minutes. */
export async function recordLoginFailure(email: string): Promise<void> {
  await sql`
    INSERT INTO login_attempts (email, failures, last_failure_at) VALUES (${email}, 1, now())
    ON CONFLICT (email) DO UPDATE SET
      failures = CASE WHEN login_attempts.last_failure_at < now() - interval '1 day' THEN 1 ELSE login_attempts.failures + 1 END,
      last_failure_at = now()
  `
  await sql`
    UPDATE login_attempts
    SET locked_until = now() + make_interval(mins => least(${MAX_LOCK_MINUTES}, power(2, failures - ${FREE_FAILURES})::int))
    WHERE email = ${email} AND failures >= ${FREE_FAILURES}
  `
}

export async function clearLoginFailures(email: string): Promise<void> {
  await sql`DELETE FROM login_attempts WHERE email = ${email}`
}

export async function purgeLoginAttempts(): Promise<number> {
  const rows = await sql`DELETE FROM login_attempts WHERE last_failure_at < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())`
  return rows.count
}
