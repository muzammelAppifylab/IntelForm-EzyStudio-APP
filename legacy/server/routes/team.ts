import { Hono } from 'hono'
import type { PendingInvite, TeamMember, TeamResponse } from '../../shared/api'
import { memberUpdateInput, transferOwnershipInput } from '../../shared/auth'
import { can } from '../../shared/roles'
import { sql } from '../db/client'
import { ApiError, conflict, notFound } from '../lib/errors'
import { assertPasswordNotEmail, hashPassword, verifyPassword } from '../lib/password'
import { rateLimit } from '../lib/rate-limit'
import { revokeCredentials } from '../lib/session'
import { readBody, uuidParam } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

export const teamRoutes = new Hono<AppEnv>().use(requireUser)

/**
 * Re-checks the signed-in member's own password before a sensitive action. Shares one rate
 * limit with the Profile page, so a stolen session can't use it as a password oracle.
 */
async function confirmOwnPassword(userId: string, currentPassword: string): Promise<void> {
  await rateLimit(`reauth:user:${userId}`, 10, 15 * 60)
  const [{ password_hash }] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${userId}`
  if (!(await verifyPassword(password_hash, currentPassword))) {
    throw new ApiError(422, 'validation_failed', 'Check the highlighted fields', { currentPassword: ['That password isn’t right'] })
  }
}

teamRoutes.get('/', requirePermission('team.view'), async (c) => {
  const members = await sql<TeamMember[]>`
    SELECT id, name, email, role, avatar_url AS "avatarUrl", created_at AS "createdAt"
    FROM users WHERE status = 'active'
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name
  `
  const invites = can(c.var.user.role, 'team.manage')
    ? await sql<PendingInvite[]>`
        SELECT id, email, role, expires_at AS "expiresAt", created_at AS "createdAt"
        FROM invites WHERE accepted_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
      `
    : []
  return c.json<TeamResponse>({ members, invites })
})

/** Owner changes a member's role or sets a new password for them (no email provider yet). */
teamRoutes.patch('/:userId', requirePermission('team.manage'), async (c) => {
  const userId = uuidParam(c, 'userId', 'That team member no longer exists')
  const input = await readBody(c, memberUpdateInput)
  if (userId === c.var.user.id) throw new ApiError(400, 'own_account', 'Change your own details on your Profile page')

  let passwordHash: string | null = null
  if (input.password) {
    // Setting someone's password is an account takeover if the session is stolen: re-check ours.
    await confirmOwnPassword(c.var.user.id, input.currentPassword ?? '')
    const [member] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId} AND status = 'active' AND role <> 'owner'`
    if (!member) throw notFound('That team member no longer exists')
    assertPasswordNotEmail(input.password, member.email)
    passwordHash = await hashPassword(input.password)
  }
  await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      UPDATE users SET
        role = COALESCE(${input.role ?? null}, role),
        password_hash = COALESCE(${passwordHash}, password_hash),
        updated_at = now()
      WHERE id = ${userId} AND status = 'active' AND role <> 'owner'
      RETURNING id
    `
    if (!row) throw notFound('That team member no longer exists')
    // A password set by the Owner signs the member out everywhere and voids their reset links.
    if (passwordHash) await revokeCredentials(tx, userId)
  })
  return c.json({ ok: true })
})

/** Removing keeps the user row (forms they made stay), ends every session at once. */
teamRoutes.delete('/:userId', requirePermission('team.manage'), async (c) => {
  const userId = uuidParam(c, 'userId', 'That team member no longer exists')
  if (userId === c.var.user.id) throw new ApiError(400, 'own_account', 'Transfer ownership before you leave the team')

  const [row] = await sql<{ id: string }[]>`
    UPDATE users SET status = 'removed', updated_at = now()
    WHERE id = ${userId} AND status = 'active' AND role <> 'owner'
    RETURNING id
  `
  if (!row) throw notFound('That team member no longer exists')
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`
  return c.body(null, 204)
})

/** Hands the Owner role to another member; the old Owner becomes an Editor. */
teamRoutes.post('/transfer-ownership', requirePermission('team.manage'), async (c) => {
  const input = await readBody(c, transferOwnershipInput)
  const me = c.var.user
  if (input.userId === me.id) throw new ApiError(400, 'own_account', 'You are already the Owner')

  await confirmOwnPassword(me.id, input.currentPassword)

  await sql.begin(async (tx) => {
    // Demote first: the unique index allows only one active Owner at any moment. RETURNING
    // proves this request still held the Owner role; a concurrent transfer gets a 409 (A11).
    const [demoted] = await tx<{ id: string }[]>`
      UPDATE users SET role = 'editor', updated_at = now()
      WHERE id = ${me.id} AND role = 'owner' AND status = 'active'
      RETURNING id
    `
    if (!demoted) throw conflict('Ownership already moved to someone else. Refresh the page.')
    const [row] = await tx<{ id: string }[]>`
      UPDATE users SET role = 'owner', updated_at = now()
      WHERE id = ${input.userId} AND status = 'active'
      RETURNING id
    `
    if (!row) throw notFound('That team member no longer exists')
  })
  return c.json({ ok: true })
})
