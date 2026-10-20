import { Hono } from 'hono'
import { forgotInput, loginInput, resetInput } from '../../shared/auth'
import { sql } from '../db/client'
import { env } from '../env'
import { hashToken, randomToken } from '../lib/crypto'
import { emailEnabled, queueEmail } from '../lib/email'
import { ApiError } from '../lib/errors'
import { ipKey } from '../lib/ip'
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password'
import { assertLoginAllowed, clearLoginFailures, rateLimit, recordLoginFailure } from '../lib/rate-limit'
import { endSession, readSession, startSession, toMe, type UserRow } from '../lib/session'
import { getSetting } from '../lib/settings'
import { readBody } from '../lib/validate'

export const authRoutes = new Hono()

const RESET_MINUTES = 60
const BAD_CREDENTIALS = 'That email and password don’t match. Try again.'

authRoutes.post('/login', async (c) => {
  const input = await readBody(c, loginInput)
  // Per IP: stops one client spraying many accounts. Per account: exponential backoff (below).
  await rateLimit(`login:ip:${ipKey(c)}`, 30, 15 * 60)
  await assertLoginAllowed(input.email)

  const [user] = await sql<(UserRow & { password_hash: string })[]>`
    SELECT id, name, email, role, avatar_url, password_hash FROM users
    WHERE email = ${input.email} AND status = 'active'
  `
  if (!user) {
    await burnPasswordCheck(input.password)
    await recordLoginFailure(input.email)
    throw new ApiError(401, 'invalid_credentials', BAD_CREDENTIALS)
  }
  if (!(await verifyPassword(user.password_hash, input.password))) {
    await recordLoginFailure(input.email)
    throw new ApiError(401, 'invalid_credentials', BAD_CREDENTIALS)
  }
  await clearLoginFailures(input.email)
  await startSession(c, user.id)
  return c.json(toMe(user))
})

authRoutes.post('/logout', async (c) => {
  const user = await readSession(c)
  await endSession(c, user?.sessionId)
  return c.body(null, 204)
})

/**
 * Always answers 200 for a known or unknown email, so it can't be used to discover accounts.
 * The email is queued (not sent inline), so both paths take about the same time.
 */
authRoutes.post('/forgot', async (c) => {
  if (!(await emailEnabled())) {
    throw new ApiError(503, 'email_not_configured', 'Password reset by email isn’t set up yet. Ask the Owner to set a new password for you.')
  }
  const { email } = await readBody(c, forgotInput)
  await rateLimit(`forgot:ip:${ipKey(c)}`, 5, 15 * 60)
  await rateLimit(`forgot:email:${hashToken(email)}`, 3, 60 * 60)

  const [user] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM users WHERE email = ${email} AND status = 'active'`
  if (user) {
    const token = randomToken()
    const { appName } = await getSetting('general')
    await sql.begin(async (tx) => {
      // A new link replaces any older one (A7).
      await tx`UPDATE password_resets SET used_at = now() WHERE user_id = ${user.id} AND used_at IS NULL`
      await tx`
        INSERT INTO password_resets (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${hashToken(token)}, now() + make_interval(mins => ${RESET_MINUTES}))
      `
      await queueEmail(tx, {
        to: email,
        subject: `Reset your ${appName} password`,
        text: `Hi ${user.name},\n\nUse this link to choose a new password. It works for ${RESET_MINUTES} minutes.\n\n${env.APP_URL}/reset/${token}\n\nIf you didn't ask for this, you can ignore this email.`,
      })
    })
  }
  return c.json({ ok: true })
})

const RESET_EXPIRED = 'This reset link has expired or was already used. Ask for a new one.'

authRoutes.post('/reset', async (c) => {
  const input = await readBody(c, resetInput)
  await rateLimit(`reset:ip:${ipKey(c)}`, 10, 15 * 60)
  const tokenHash = hashToken(input.token)

  // Cheap check first: only hash the password (argon2, ~19 MiB) for a live link (A3).
  const [open] = await sql`SELECT 1 FROM password_resets WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > now()`
  if (!open) throw new ApiError(410, 'link_expired', RESET_EXPIRED)
  const passwordHash = await hashPassword(input.password)

  const me = await sql.begin(async (tx) => {
    const [reset] = await tx<{ id: string; user_id: string }[]>`
      SELECT r.id, r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ${tokenHash} AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'active'
      FOR UPDATE OF r
    `
    if (!reset) throw new ApiError(410, 'link_expired', RESET_EXPIRED)

    // Uses this link and voids every other open one for the account.
    await tx`UPDATE password_resets SET used_at = now() WHERE user_id = ${reset.user_id} AND used_at IS NULL`
    const [user] = await tx<UserRow[]>`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${reset.user_id}
      RETURNING id, name, email, role, avatar_url
    `
    // A reset signs out every device, then starts a fresh session here.
    await tx`DELETE FROM sessions WHERE user_id = ${user.id}`
    await startSession(c, user.id, tx)
    return toMe(user)
  })
  await clearLoginFailures(me.email)
  return c.json(me)
})
