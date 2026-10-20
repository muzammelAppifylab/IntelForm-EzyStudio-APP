import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id with the library defaults (19 MiB, 2 passes), as OWASP recommends. Each run costs
 * ~19 MiB and 50–100 ms, so at most MAX_CONCURRENT run at once; the rest wait their turn. That
 * caps memory under a burst instead of letting it grow with the number of requests.
 */
const MAX_CONCURRENT = 4
let running = 0
const waiting: (() => void)[] = []

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

export function hashPassword(password: string): Promise<string> {
  return limited(() => hash(password))
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await limited(() => verify(passwordHash, password))
  } catch {
    return false
  }
}

// Verified against when the email is unknown, so login takes the same time either way.
let dummyHash: Promise<string> | undefined

export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('intelform-timing-equaliser')
  await verifyPassword(await dummyHash, password)
}
