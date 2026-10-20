import { Hono } from 'hono'
import type { SetupStatus } from '../../shared/api'
import { setupInput } from '../../shared/auth'
import { sql } from '../db/client'
import { ApiError } from '../lib/errors'
import { ipKey } from '../lib/ip'
import { hashPassword } from '../lib/password'
import { rateLimit } from '../lib/rate-limit'
import { startSession, toMe, type UserRow } from '../lib/session'
import { setSetting } from '../lib/settings'
import { readBody } from '../lib/validate'

/** First-run setup: creates the Owner on a fresh install, then never again. */
export const setupRoutes = new Hono()

const ALREADY = 'This app is already set up. Log in instead.'

async function needsSetup() {
  const [{ exists }] = await sql<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM users) AS exists`
  return !exists
}

setupRoutes.get('/', async (c) => c.json<SetupStatus>({ needsSetup: await needsSetup() }))

setupRoutes.post('/', async (c) => {
  const input = await readBody(c, setupInput)
  await rateLimit(`setup:ip:${ipKey(c)}`, 10, 15 * 60)
  // Cheap check before the expensive hash (A3); re-checked under the lock below.
  if (!(await needsSetup())) throw new ApiError(409, 'already_set_up', ALREADY)
  const passwordHash = await hashPassword(input.password)

  const me = await sql.begin(async (tx) => {
    // Serialise concurrent setup attempts so only the first one can create the Owner.
    await tx`SELECT pg_advisory_xact_lock(hashtext('intelform:setup'))`
    const [{ exists }] = await tx<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM users) AS exists`
    if (exists) throw new ApiError(409, 'already_set_up', ALREADY)

    const [user] = await tx<UserRow[]>`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (${input.name}, ${input.email}, ${passwordHash}, 'owner')
      RETURNING id, name, email, role, avatar_url
    `
    await setSetting('general', { appName: input.appName }, tx)
    await startSession(c, user.id, tx)
    return toMe(user)
  })

  return c.json(me, 201)
})
