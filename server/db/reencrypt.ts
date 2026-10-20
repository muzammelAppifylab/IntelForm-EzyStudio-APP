import { pathToFileURL } from 'node:url'
import { env } from '../env'
import { reencryptSecret } from '../lib/crypto'
import { logger } from '../lib/logger'
import { SECRET_FIELDS, settingsChanged, type AppSettings } from '../lib/settings'
import { sql as defaultSql, type Sql } from './client'

/**
 * Re-encrypts every stored secret under the current APP_SECRET, so APP_SECRET_PREVIOUS can be
 * dropped without losing anything:
 *
 *   forms.webhook_secret                       per-form webhook signing secrets
 *   app_settings.<key>.<field>                 every field in SECRET_FIELDS (Turnstile, email)
 *
 * One transaction (rows locked FOR UPDATE, plus an advisory lock so instances booting together
 * take turns). Values already under the current key are left alone, so a second run changes
 * nothing. A value no configured key can open is counted as unreadable and left untouched: it
 * has to be entered again (Settings) or rotated (webhook secret).
 *
 * Rotation: set APP_SECRET to the new value and APP_SECRET_PREVIOUS to the old one, deploy
 * (the server runs this at boot while APP_SECRET_PREVIOUS is set), or run
 * `npm run secrets:reencrypt`; once it reports 0 unreadable, remove APP_SECRET_PREVIOUS.
 */
export interface ReencryptReport {
  /** Stored secrets looked at. */
  checked: number
  /** Rewritten under the current key. */
  reencrypted: number
  /** Where a value could not be decrypted with APP_SECRET or APP_SECRET_PREVIOUS. */
  unreadable: string[]
}

const LOCK_KEY = 'intelform:reencrypt'

export async function reencryptSecrets(sql: Sql = defaultSql): Promise<ReencryptReport> {
  const report: ReencryptReport = { checked: 0, reencrypted: 0, unreadable: [] }
  const changedKeys: (keyof AppSettings)[] = []

  /** The value under the current key, or null when it needs no change or can't be read. */
  const next = (stored: string, where: string): string | null => {
    report.checked++
    try {
      const out = reencryptSecret(stored)
      if (out === stored) return null
      report.reencrypted++
      return out
    } catch {
      report.unreadable.push(where)
      return null
    }
  }

  await sql.begin(async (tx) => {
    // Maintenance work: the pool's per-statement timeout doesn't apply (SET LOCAL ends with the transaction).
    await tx`SET LOCAL statement_timeout = 0`
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`

    const forms = await tx<{ id: string; webhook_secret: string }[]>`
      SELECT id, webhook_secret FROM forms WHERE webhook_secret IS NOT NULL ORDER BY id FOR UPDATE
    `
    for (const f of forms) {
      const value = next(f.webhook_secret, `forms.webhook_secret (form ${f.id})`)
      if (value) await tx`UPDATE forms SET webhook_secret = ${value} WHERE id = ${f.id}`
    }

    for (const [key, fields] of Object.entries(SECRET_FIELDS) as [keyof typeof SECRET_FIELDS, readonly string[]][]) {
      const [row] = await tx<{ value: Record<string, unknown> }[]>`SELECT value FROM app_settings WHERE key = ${key} FOR UPDATE`
      if (!row) continue
      const patch: Record<string, string> = {}
      for (const field of fields) {
        const stored = row.value[field]
        if (typeof stored !== 'string' || !stored) continue
        const value = next(stored, `app_settings ${key}.${field}`)
        if (value) patch[field] = value
      }
      if (Object.keys(patch).length) {
        // updated_at stays: the setting itself didn't change.
        await tx`UPDATE app_settings SET value = value || ${tx.json(patch)} WHERE key = ${key}`
        changedKeys.push(key)
      }
    }
  })

  // After the commit, as for any setting change (e.g. the cached email transport is rebuilt).
  for (const key of changedKeys) settingsChanged(key)
  return report
}

/**
 * Boot hook for server/index.ts, after migrations: re-encrypts while APP_SECRET_PREVIOUS is set.
 * Never stops the boot; a failure is logged and the next boot tries again.
 */
export async function reencryptSecretsOnBoot(sql: Sql = defaultSql): Promise<void> {
  if (!env.APP_SECRET_PREVIOUS) return
  try {
    const { checked, reencrypted, unreadable } = await reencryptSecrets(sql)
    logger.info({ checked, reencrypted, unreadable: unreadable.length }, 'stored secrets re-encrypted under APP_SECRET')
    if (unreadable.length) logger.warn({ unreadable }, 'some stored secrets open with neither APP_SECRET nor APP_SECRET_PREVIOUS; enter them again')
  } catch (err) {
    logger.warn({ err }, 'stored secrets not re-encrypted (run npm run secrets:reencrypt)')
  }
}

// Run as a script (npm run secrets:reencrypt), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { checked, reencrypted, unreadable } = await reencryptSecrets()
    console.log(`${checked} stored secret(s) checked, ${reencrypted} re-encrypted under APP_SECRET, ${unreadable.length} unreadable`)
    if (unreadable.length) {
      for (const where of unreadable) console.log(`  unreadable: ${where}`)
      console.log('These open with neither APP_SECRET nor APP_SECRET_PREVIOUS. Enter them again in Settings (or rotate the webhook secret) before removing APP_SECRET_PREVIOUS.')
      process.exitCode = 1
    } else if (env.APP_SECRET_PREVIOUS) {
      console.log('Every stored secret now uses APP_SECRET. You can remove APP_SECRET_PREVIOUS.')
    }
  } catch (err) {
    console.error((err as Error).message)
    process.exitCode = 1
  } finally {
    await defaultSql.end({ timeout: 5 })
  }
}
