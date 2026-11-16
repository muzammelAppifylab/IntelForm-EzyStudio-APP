import { createMiddleware } from 'hono/factory'
import { can, type Permission } from '../../shared/roles'
import { ApiError, forbidden } from '../lib/errors'
import { readSession, type SessionUser } from '../lib/session'

export type AppEnv = { Variables: { user: SessionUser } }

/** Requires a signed-in team member; puts them on c.var.user. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c)
  if (!user) throw new ApiError(401, 'unauthenticated', 'Log in to continue')
  c.set('user', user)
  await next()
})

/** Role check for one permission from shared/roles. Use after requireUser. */
export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.user.role, permission)) throw forbidden()
    await next()
  })
}
