import { Hono } from 'hono'
import { profileInput } from '../../shared/auth'
import { sql } from '../db/client'
import { ApiError } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { rateLimit } from '../lib/rate-limit'
import { toMe, type UserRow } from '../lib/session'
import { readBody } from '../lib/validate'
import { requireUser, type AppEnv } from '../middleware/auth'

export const meRoutes = new Hono<AppEnv>().use(requireUser)

meRoutes.get('/', (c) => {
  const { sessionId: _, ...me } = c.var.user
  return c.json(me)
})

meRoutes.patch('/', async (c) => {
  const input = await readBody(c, profileInput)
  const user = c.var.user

  if (input.currentPassword && (input.email || input.newPassword)) {
    // A stolen session must not be a free password oracle (shared with transfer-ownership).
    await rateLimit(`reauth:user:${user.id}`, 10, 15 * 60)
    const [{ password_hash }] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`
    if (!(await verifyPassword(password_hash, input.currentPassword))) {
      throw new ApiError(422, 'validation_failed', 'Check the highlighted fields', { currentPassword: ['That password isn’t right'] })
    }
  }
  if (input.email && input.email !== user.email) {
    const [taken] = await sql`SELECT 1 FROM users WHERE email = ${input.email} AND id <> ${user.id}`
    if (taken) throw new ApiError(422, 'validation_failed', 'Check the highlighted fields', { email: ['Another team member already uses this email'] })
  }

  const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null
  const row = await sql.begin(async (tx) => {
    const [updated] = await tx<UserRow[]>`
      UPDATE users SET
        name = COALESCE(${input.name ?? null}, name),
        email = COALESCE(${input.email ?? null}, email),
        password_hash = COALESCE(${passwordHash}, password_hash),
        avatar_url = CASE WHEN ${input.avatarUrl !== undefined} THEN ${input.avatarUrl ?? null} ELSE avatar_url END,
        updated_at = now()
      WHERE id = ${user.id}
      RETURNING id, name, email, role, avatar_url
    `
    if (passwordHash) {
      // A new password signs out every other session and voids open reset links (A7).
      await tx`DELETE FROM sessions WHERE user_id = ${user.id} AND id <> ${user.sessionId}`
      await tx`UPDATE password_resets SET used_at = now() WHERE user_id = ${user.id} AND used_at IS NULL`
    }
    return updated
  })
  return c.json(toMe(row))
})
