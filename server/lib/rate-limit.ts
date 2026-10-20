import { sql } from '../db/client'
import { hashToken } from './crypto'
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
// Login backoff (per account and caller, A2 / B3)
// ---------------------------------------------------------------------------
//
// Two layers, both applied the same way whether or not the account exists:
//
// 1. Backoff per (email, caller IP key): after 5 failures, lock for 1, 2, 4, 8, 15, 15 …
//    minutes. Keyed on the caller too, so wrong passwords from one client only lock that
//    client out, never the real user signing in from somewhere else.
// 2. A ceiling per email across all callers: 50 failures in a 15-minute window locks the email
//    until the window ends. The per-caller backoff holds one client to about 8 failures per
//    15 minutes, so a typing user never gets near it and tripping it takes several cooperating
//    IPs. It caps distributed guessing at about 200 tries an hour per account, and the worst
//    lock it can impose is the rest of one 15-minute window.
//
// login_attempts.email holds the composite key "<email> <ipKey>" (the column predates per-caller
// keys; a validated email has no spaces, so the space separates the parts unambiguously).

const FREE_FAILURES = 5
const MAX_LOCK_MINUTES = 15
const EMAIL_CEILING = 50
const EMAIL_CEILING_WINDOW = 15 * 60

function attemptKey(email: string, ip: string): string {
  return `${email} ${ip}`
}

function ceilingKey(email: string): string {
  return `login:email-fail:${hashToken(email)}`
}

function lockedMessage(wait: number): string {
  return `Too many failed attempts. Wait ${wait < 90 ? 'a minute' : `${Math.ceil(wait / 60)} minutes`} and try again.`
}

/** Throws 429 while this caller is backed off for the email, or the email hit its ceiling. */
export async function assertLoginAllowed(email: string, ip: string): Promise<void> {
  const [row] = await sql<{ wait: number }[]>`
    SELECT ceil(extract(epoch FROM locked_until - now()))::int AS wait
    FROM login_attempts WHERE email = ${attemptKey(email, ip)} AND locked_until > now()
  `
  if (row) throw tooMany(row.wait, lockedMessage(row.wait))

  const [ceiling] = await sql<{ wait: number }[]>`
    SELECT ceil(extract(epoch FROM (window_start + make_interval(secs => window_seconds) - now())))::int AS wait
    FROM rate_limits
    WHERE key = ${ceilingKey(email)}
      AND window_start = date_bin(make_interval(secs => ${EMAIL_CEILING_WINDOW}), now(), 'epoch')
      AND count >= ${EMAIL_CEILING}
  `
  if (ceiling) throw tooMany(ceiling.wait, lockedMessage(ceiling.wait))
}

/** Records a failure for this caller and counts it toward the email's ceiling. */
export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const key = attemptKey(email, ip)
  await sql`
    INSERT INTO login_attempts (email, failures, last_failure_at) VALUES (${key}, 1, now())
    ON CONFLICT (email) DO UPDATE SET
      failures = CASE WHEN login_attempts.last_failure_at < now() - interval '1 day' THEN 1 ELSE login_attempts.failures + 1 END,
      last_failure_at = now()
  `
  await sql`
    UPDATE login_attempts
    SET locked_until = now() + make_interval(mins => least(${MAX_LOCK_MINUTES}, power(2, failures - ${FREE_FAILURES})::int))
    WHERE email = ${key} AND failures >= ${FREE_FAILURES}
  `
  await hit(ceilingKey(email), EMAIL_CEILING_WINDOW)
}

/**
 * Clears this caller's backoff after a successful sign-in. Other callers' backoff stays, so a
 * guesser doesn't get fresh free tries each time the real user signs in.
 */
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  await sql`DELETE FROM login_attempts WHERE email = ${attemptKey(email, ip)}`
}

/** Clears every caller's backoff for the email (after a password reset, old guesses are moot). */
export async function clearAllLoginFailures(email: string): Promise<void> {
  await sql`DELETE FROM login_attempts WHERE email = ${email} OR starts_with(email, ${`${email} `})`
}

export async function purgeLoginAttempts(): Promise<number> {
  const rows = await sql`DELETE FROM login_attempts WHERE last_failure_at < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())`
  return rows.count
}
