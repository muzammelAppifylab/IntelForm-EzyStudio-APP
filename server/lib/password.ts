import { hash, verify } from '@node-rs/argon2'
import { EMAIL_PASSWORD_MESSAGE, passwordMatchesEmail } from '../../shared/auth'
import { ApiError } from './errors'

/**
 * Argon2id with the library defaults (19 MiB, 2 passes), as OWASP recommends. Each run costs ~19 MiB and
 * 50–100 ms, so the work goes through bounded pools: a few runs at a time, a short waiting line, and a fast 503
 * once the line is full. That caps memory under a burst instead of letting it grow with the number of requests.
 *
 * There are two pools so anonymous traffic can't starve the team:
 * - team (4 running / 64 waiting): login, setup, reset, invites, password changes, the login timing equaliser
 *   and hashing a form password in the builder. Worst case ~76 MiB of argon2 memory and a ~1–2 s wait at the
 *   back of a full line, which still feels like a slow login rather than an outage.
 * - public (2 running / 16 waiting): verifying a form password on the unauthenticated unlock route. Worst case
 *   ~38 MiB and well under a second of waiting; a flood beyond that gets a 503 instead of queuing behind it.
 */
export interface Pool {
  run<T>(fn: () => Promise<T>): Promise<T>
  readonly running: number
  readonly waiting: number
}

export const busyError = () => new ApiError(503, 'busy', 'The server is busy. Try again in a moment.', undefined, { 'Retry-After': '1' })

export function createPool(maxConcurrent: number, maxWaiting: number): Pool {
  let running = 0
  const waiting: (() => void)[] = []
  return {
    get running() {
      return running
    },
    get waiting() {
      return waiting.length
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (running >= maxConcurrent) {
        if (waiting.length >= maxWaiting) throw busyError()
        // The slot is handed over by the finishing run (running isn't decremented in between), so no one can jump the line.
        await new Promise<void>((resolve) => waiting.push(resolve))
      } else {
        running++
      }
      try {
        return await fn()
      } finally {
        const next = waiting.shift()
        if (next) next()
        else running--
      }
    },
  }
}

export const teamPool = createPool(4, 64)
export const publicPool = createPool(2, 16)

async function verifyIn(pool: Pool, passwordHash: string, password: string): Promise<boolean> {
  // A busy pool throws its 503; only a malformed hash or a library failure counts as a wrong password.
  return pool.run(async () => {
    try {
      return await verify(passwordHash, password)
    } catch {
      return false
    }
  })
}

/** Team-side hash: account passwords, and form passwords set in the builder. */
export function hashPassword(password: string): Promise<string> {
  return teamPool.run(() => hash(password))
}

/** Team-side verify: login and current-password checks. */
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verifyIn(teamPool, passwordHash, password)
}

/** Public-side verify: a respondent unlocking a password-protected form. */
export function verifyFormPassword(passwordHash: string, password: string): Promise<boolean> {
  return verifyIn(publicPool, passwordHash, password)
}

// Verified against when the email is unknown, so login takes the same time either way. Runs in the team pool,
// like a real login check, so the two paths also queue (or 503) the same way.
let dummyHash: Promise<string> | undefined

export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('intelform-timing-equaliser').catch((err: unknown) => {
    dummyHash = undefined // a busy pool shouldn't poison the cache; try again next time
    throw err
  })
  await verifyPassword(await dummyHash, password)
}

/**
 * The account-password rule the zod schema can't check on its own: the password must not be
 * the account's email or the part before the @. Throws a 422 on `field`. Call before hashing.
 */
export function assertPasswordNotEmail(password: string, email: string, field = 'password'): void {
  if (passwordMatchesEmail(password, email)) {
    throw new ApiError(422, 'validation_failed', 'Check the highlighted fields', { [field]: [EMAIL_PASSWORD_MESSAGE] })
  }
}
