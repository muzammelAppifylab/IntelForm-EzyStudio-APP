import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env'

/** URL-safe random token for sessions, invites and reset links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Tokens are stored only as their SHA-256 hash, so a database leak exposes no live links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * A 32-byte key derived from an app secret for one purpose (HKDF-SHA256), so the
 * encryption key, the IP-hash salt and anything else never share key material.
 */
export function subkey(purpose: string, secret: string = env.APP_SECRET): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'intelform', `intelform:${purpose}`, 32))
}

const ipKey = subkey('ip-hash')

/** Salted IP hash for responses, sessions and rate limits: the raw IP is never stored (PRD privacy). */
export function hashIp(ip: string): string {
  return createHmac('sha256', ipKey).update(ip).digest('hex').slice(0, 32)
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ---------------------------------------------------------------------------
// Secrets at rest (Turnstile secret, email credentials, webhook secrets)
//
// v2.<kid>.<iv>.<tag>.<data>   AES-256-GCM, key = HKDF(APP_SECRET, "secrets"), kid = key id
// v1.<iv>.<tag>.<data>         legacy, key = sha256("intelform:secrets:" + APP_SECRET); read only
//
// With APP_SECRET_PREVIOUS set, values written under the old secret still decrypt. The server
// moves them all to the new key at boot while APP_SECRET_PREVIOUS is set, and
// `npm run secrets:reencrypt` does the same on demand (server/db/reencrypt.ts, which uses
// reencryptSecret); remove APP_SECRET_PREVIOUS once it reports 0 unreadable. Losing
// APP_SECRET makes every stored secret unrecoverable.
// ---------------------------------------------------------------------------

interface SecretKey {
  kid: string
  key: Buffer
  legacy: Buffer
}

function makeKey(secret: string): SecretKey {
  const key = subkey('secrets', secret)
  return {
    kid: createHash('sha256').update(key).digest('base64url').slice(0, 8),
    key,
    legacy: createHash('sha256').update(`intelform:secrets:${secret}`).digest(),
  }
}

const currentKey = makeKey(env.APP_SECRET)
const keys: SecretKey[] = [currentKey, ...(env.APP_SECRET_PREVIOUS ? [makeKey(env.APP_SECRET_PREVIOUS)] : [])]

/** Encrypts a secret before it goes into the database. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', currentKey.key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v2', currentKey.kid, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

function open(key: Buffer, iv: string, tag: string, data: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

export function decryptSecret(stored: string): string {
  const parts = stored.split('.')
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, iv, tag, data] = parts
    const k = keys.find((x) => x.kid === kid)
    if (!k) throw new Error('This secret was encrypted with an unknown APP_SECRET')
    return open(k.key, iv, tag, data)
  }
  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, tag, data] = parts
    for (const k of keys) {
      try {
        return open(k.legacy, iv, tag, data)
      } catch {
        // try the next key
      }
    }
    throw new Error('This secret was encrypted with an unknown APP_SECRET')
  }
  throw new Error('Unrecognised secret format')
}

/** True when the value is not in the current format and key (re-encrypt it on the next save). */
export function needsReencrypt(stored: string): boolean {
  return !stored.startsWith(`v2.${currentKey.kid}.`)
}

export function reencryptSecret(stored: string): string {
  return needsReencrypt(stored) ? encryptSecret(decryptSecret(stored)) : stored
}
