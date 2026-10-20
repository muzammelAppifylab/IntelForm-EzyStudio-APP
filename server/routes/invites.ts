import { Hono } from 'hono'
import type { CreatedInvite, InviteInfo, PendingInvite } from '../../shared/api'
import { acceptInviteInput, inviteInput } from '../../shared/auth'
import { sql } from '../db/client'
import { env } from '../env'
import { hashToken, randomToken } from '../lib/crypto'
import { queueEmail } from '../lib/email'
import { ApiError, notFound } from '../lib/errors'
import { ipKey } from '../lib/ip'
import { hashPassword } from '../lib/password'
import { rateLimit } from '../lib/rate-limit'
import { startSession, toMe, type UserRow } from '../lib/session'
import { getSetting } from '../lib/settings'
import { readBody, uuidParam } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

/** Invite links are valid for 7 days (PRD "Team"). */
const INVITE_DAYS = 7

export const inviteRoutes = new Hono<AppEnv>()

inviteRoutes.post('/', requireUser, requirePermission('team.manage'), async (c) => {
  const input = await readBody(c, inviteInput)
  const [member] = await sql`SELECT 1 FROM users WHERE email = ${input.email} AND status = 'active'`
  if (member) {
    throw new ApiError(422, 'validation_failed', 'Check the highlighted fields', { email: ['This person is already on the team'] })
  }

  const token = randomToken()
  const link = `${env.APP_URL}/invite/${token}`
  const { appName } = await getSetting('general')
  const { invite, emailed } = await sql.begin(async (tx) => {
    // Re-inviting the same email replaces the open invite (and its old link).
    await tx`DELETE FROM invites WHERE email = ${input.email} AND accepted_at IS NULL`
    const [row] = await tx<PendingInvite[]>`
      INSERT INTO invites (email, role, token_hash, invited_by, expires_at)
      VALUES (${input.email}, ${input.role}, ${hashToken(token)}, ${c.var.user.id}, now() + make_interval(days => ${INVITE_DAYS}))
      RETURNING id, email, role, expires_at AS "expiresAt", created_at AS "createdAt"
    `
    // Queued with the invite: sent by the jobs worker after commit, never awaited here.
    const queued = await queueEmail(tx, {
      to: input.email,
      subject: `${c.var.user.name} invited you to ${appName}`,
      text: `${c.var.user.name} invited you to join ${appName}.\n\nSet your name and password here (the link works for ${INVITE_DAYS} days):\n\n${link}`,
    })
    return { invite: row, emailed: queued }
  })
  return c.json<CreatedInvite>({ invite, link, emailed }, 201)
})

inviteRoutes.delete('/:id', requireUser, requirePermission('team.manage'), async (c) => {
  const id = uuidParam(c, 'id', 'That invite no longer exists')
  const [row] = await sql`DELETE FROM invites WHERE id = ${id} AND accepted_at IS NULL RETURNING id`
  if (!row) throw notFound('That invite no longer exists')
  return c.body(null, 204)
})

async function openInvite(token: string) {
  const [invite] = await sql<{ id: string; email: string; role: 'editor' | 'viewer' }[]>`
    SELECT id, email, role FROM invites
    WHERE token_hash = ${hashToken(token)} AND accepted_at IS NULL AND expires_at > now()
  `
  if (!invite) throw new ApiError(410, 'link_expired', 'This invite has expired or was already used. Ask the Owner for a new link.')
  return invite
}

/** Public: lets the accept page show who the invite is for. */
inviteRoutes.get('/:token', async (c) => {
  await rateLimit(`invite-view:ip:${ipKey(c)}`, 60, 15 * 60)
  const invite = await openInvite(c.req.param('token'))
  const { appName } = await getSetting('general')
  return c.json<InviteInfo>({ email: invite.email, role: invite.role, appName })
})

/** Public: the only way to create an account after setup. */
inviteRoutes.post('/:token/accept', async (c) => {
  const input = await readBody(c, acceptInviteInput)
  await rateLimit(`accept:ip:${ipKey(c)}`, 10, 15 * 60)
  // Cheap check first: only hash the password (argon2) for a live invite (A3).
  await openInvite(c.req.param('token'))
  const passwordHash = await hashPassword(input.password)
  const tokenHash = hashToken(c.req.param('token'))

  const me = await sql.begin(async (tx) => {
    const [invite] = await tx<{ id: string; email: string; role: 'editor' | 'viewer' }[]>`
      SELECT id, email, role FROM invites
      WHERE token_hash = ${tokenHash} AND accepted_at IS NULL AND expires_at > now()
      FOR UPDATE
    `
    if (!invite) throw new ApiError(410, 'link_expired', 'This invite has expired or was already used. Ask the Owner for a new link.')

    const [existing] = await tx<{ id: string; status: string }[]>`SELECT id, status FROM users WHERE email = ${invite.email}`
    if (existing?.status === 'active') throw new ApiError(409, 'already_member', 'You’re already on the team. Log in instead.')

    // A removed member who is invited back gets their old account (and forms) back.
    const [user] = existing
      ? await tx<UserRow[]>`
          UPDATE users SET name = ${input.name}, password_hash = ${passwordHash}, role = ${invite.role}, status = 'active', updated_at = now()
          WHERE id = ${existing.id}
          RETURNING id, name, email, role, avatar_url
        `
      : await tx<UserRow[]>`
          INSERT INTO users (name, email, password_hash, role)
          VALUES (${input.name}, ${invite.email}, ${passwordHash}, ${invite.role})
          RETURNING id, name, email, role, avatar_url
        `
    await tx`UPDATE invites SET accepted_at = now() WHERE id = ${invite.id}`
    await startSession(c, user.id, tx)
    return toMe(user)
  })
  return c.json(me, 201)
})
