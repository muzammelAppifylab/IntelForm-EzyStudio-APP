import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insertForm, setupTestDb, type TestContext } from '../test/harness'

// Two app secrets: values written under OLD must end up under NEW.
const OLD = 'old-secret-0123456789abcdef0123456789abcdef'
const NEW = 'new-secret-0123456789abcdef0123456789abcdef'
const OTHER = 'other-secret-0123456789abcdef0123456789abcd'

let ctx: TestContext
let crypto: typeof import('../lib/crypto')

beforeAll(async () => {
  ctx = await setupTestDb({ APP_SECRET: NEW, APP_SECRET_PREVIOUS: OLD })
  crypto = await import('../lib/crypto')

}, 60_000)
afterAll(() => ctx?.teardown())

/** v2 ciphertext under `secret`, built from the documented format (not via encryptSecret, which only uses APP_SECRET). */
function v2(plain: string, secret: string): string {
  const key = crypto.subkey('secrets', secret)
  const kid = createHash('sha256').update(key).digest('base64url').slice(0, 8)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v2', kid, iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

function v1(plain: string, secret: string): string {
  const key = createHash('sha256').update(`intelform:secrets:${secret}`).digest()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** Opens a v2 value with NEW alone: proves it no longer depends on APP_SECRET_PREVIOUS. */
function openWithNew(stored: string): string {
  const [version, , iv, tag, data] = stored.split('.')
  expect(version).toBe('v2')
  const d = createDecipheriv('aes-256-gcm', crypto.subkey('secrets', NEW), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}

describe('secrets:reencrypt', () => {
  it('moves webhook and settings secrets from APP_SECRET_PREVIOUS to APP_SECRET, once', async () => {
    const { reencryptSecrets } = await import('./reencrypt')
    const { setSetting, getSetting } = await import('../lib/settings')
    const { sql } = ctx

    const oldV2 = await insertForm(sql)
    const oldV1 = await insertForm(sql)
    const current = await insertForm(sql)
    const lost = await insertForm(sql)
    const currentValue = crypto.encryptSecret('whsec_current')
    const lostValue = v2('whsec_lost', OTHER)
    await sql`UPDATE forms SET webhook_secret = ${v2('whsec_old_v2', OLD)} WHERE id = ${oldV2.id}`
    await sql`UPDATE forms SET webhook_secret = ${v1('whsec_old_v1', OLD)} WHERE id = ${oldV1.id}`
    await sql`UPDATE forms SET webhook_secret = ${currentValue} WHERE id = ${current.id}`
    await sql`UPDATE forms SET webhook_secret = ${lostValue} WHERE id = ${lost.id}`
    await setSetting('email', { driver: 'smtp', fromAddress: 'forms@example.com', smtpPass: v2('smtp-pass', OLD), resendApiKey: null })
    await setSetting('turnstile', { siteKey: 'site-key', secret: v1('turnstile-secret', OLD) })

    const first = await reencryptSecrets(sql)
    expect(first.checked).toBe(6)
    expect(first.reencrypted).toBe(4)
    expect(first.unreadable).toEqual([`forms.webhook_secret (form ${lost.id})`])

    const rows = new Map(
      (await sql<{ id: string; webhook_secret: string }[]>`SELECT id, webhook_secret FROM forms WHERE webhook_secret IS NOT NULL`).map((r) => [r.id, r.webhook_secret]),
    )
    expect(openWithNew(rows.get(oldV2.id)!)).toBe('whsec_old_v2')
    expect(openWithNew(rows.get(oldV1.id)!)).toBe('whsec_old_v1')
    expect(rows.get(current.id)).toBe(currentValue)
    expect(rows.get(lost.id)).toBe(lostValue)

    const email = await getSetting('email')
    expect(openWithNew(email.smtpPass!)).toBe('smtp-pass')
    expect(email).toMatchObject({ driver: 'smtp', fromAddress: 'forms@example.com', resendApiKey: null })
    const turnstile = await getSetting('turnstile')
    expect(openWithNew(turnstile.secret!)).toBe('turnstile-secret')
    expect(turnstile.siteKey).toBe('site-key')
    for (const v of [rows.get(oldV2.id)!, email.smtpPass!, turnstile.secret!]) expect(crypto.needsReencrypt(v)).toBe(false)

    const second = await reencryptSecrets(sql)
    expect(second).toMatchObject({ checked: 6, reencrypted: 0 })
    expect(second.unreadable).toHaveLength(1)
  })
})
