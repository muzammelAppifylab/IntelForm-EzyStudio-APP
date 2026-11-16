import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Me } from '../../shared/api'
import type { Role } from '../../shared/roles'
import { sql, type Queryable } from '../db/client'
import { isHttps } from '../env'
import { hashIp, hashToken, randomToken } from './crypto'
import { clientIp } from './ip'

/**
 * Session cookie. On https the `__Host-` prefix pins it to this exact host and path with
 * Secure set, so a sibling subdomain can't overwrite it. Plain http (local dev) can't use it.
 */
export const SESSION_COOKIE = isHttps ? '__Host-intelform_session' : 'intelform_session'
const SESSION_DAYS = 30
/** Absolute lifetime: a session ends this long after sign-in, however active it stays. */
export const SESSION_MAX_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
/** Sliding expiry is written at most once an hour per session. */
const EXTEND_AFTER_MS = 60 * 60 * 1000

export interface SessionUser extends Me {
  sessionId: string
}

export interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  avatar_url: string | null
}

export function toMe(u: UserRow): Me {
  return { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatar_url }
}

function setSessionCookie(c: Context, token: string, expires: Date) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: isHttps, sameSite: 'Lax', path: '/', expires })
}

/**
 * Starts a session and sets the httpOnly cookie. Pass `tx` to create it inside a transaction.
 * Any session the browser already had is ended first, so logging in again never leaves an
 * old session alive (A9).
 */
export async function startSession(c: Context, userId: string, tx: Queryable = sql): Promise<void> {
  const previous = getCookie(c, SESSION_COOKIE)
  if (previous) await tx`DELETE FROM sessions WHERE token_hash = ${hashToken(previous)}`

  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS)
  const ip = clientIp(c)
  await tx`
    INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip_hash)
    VALUES (${hashToken(token)}, ${userId}, ${expiresAt}, ${c.req.header('user-agent')?.slice(0, 300) ?? null}, ${ip ? hashIp(ip) : null})
  `
  setSessionCookie(c, token, expiresAt)
}

/**
 * Resolves the cookie to an active user. Removed members and expired sessions resolve to
 * null, so removing a member ends their access on their next request.
 */
export async function readSession(c: Context): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const [row] = await sql<(UserRow & { session_id: string; expires_at: Date; created_at: Date; too_old: boolean })[]>`
    SELECT s.id AS session_id, s.expires_at, s.created_at,
      s.created_at <= now() - make_interval(days => ${SESSION_MAX_DAYS}) AS too_old,
      u.id, u.name, u.email, u.role, u.avatar_url
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND u.status = 'active'
  `
  if (!row) return null
  if (row.too_old) {
    // Past the absolute lifetime: sliding expiry can't keep it alive. Sign in again.
    await endSession(c, row.session_id)
    return null
  }

  // Sliding expiry: push the expiry forward (never past the absolute lifetime), but write at
  // most once an hour.
  const fresh = Math.min(Date.now() + SESSION_DAYS * DAY_MS, row.created_at.getTime() + SESSION_MAX_DAYS * DAY_MS)
  if (fresh - row.expires_at.getTime() > EXTEND_AFTER_MS) {
    const expiresAt = new Date(fresh)
    await sql`UPDATE sessions SET expires_at = ${expiresAt} WHERE id = ${row.session_id}`
    setSessionCookie(c, token, expiresAt)
  }
  return { ...toMe(row), sessionId: row.session_id }
}

/**
 * Call whenever a user's email or password changes (in the same transaction): voids every
 * open password-reset link and ends every session except `keepSessionId` (the one making the
 * change, if any), so a stolen session or an old reset link stops working.
 */
export async function revokeCredentials(tx: Queryable, userId: string, keepSessionId?: string): Promise<void> {
  await tx`UPDATE password_resets SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`
  if (keepSessionId) await tx`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${keepSessionId}`
  else await tx`DELETE FROM sessions WHERE user_id = ${userId}`
}

export async function endSession(c: Context, sessionId: string | undefined): Promise<void> {
  if (sessionId) await sql`DELETE FROM sessions WHERE id = ${sessionId}`
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps })
}

/** @deprecated Import `clientIp` from './ip'. Kept so older imports keep working. */
export { clientIp } from './ip'
