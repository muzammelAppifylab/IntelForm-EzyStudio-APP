import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sql as defaultSql, type Sql } from './client'

/**
 * Applies every migrations/*.sql file not yet recorded in schema_migrations, in name order,
 * each in its own transaction.
 *
 * Safe when several instances boot at once: one reserved connection holds a session advisory
 * lock for the whole run, so the others wait and then find nothing left to apply.
 *
 * CLI: `npm run db:migrate`. On boot: MIGRATE_ON_BOOT=1 makes server/index.ts call runMigrations().
 */
const dir = fileURLToPath(new URL('./migrations/', import.meta.url))
const LOCK_KEY = 'intelform:migrate'

export async function runMigrations(sql: Sql = defaultSql, log: (line: string) => void = console.log): Promise<string[]> {
  const conn = await sql.reserve()
  const applied: string[] = []
  try {
    await conn`SELECT pg_advisory_lock(hashtext(${LOCK_KEY}))`
    await conn`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `
    const done = new Set((await conn<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name))
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      if (done.has(file)) continue
      const text = await readFile(dir + file, 'utf8')
      // Same connection as the lock: BEGIN … COMMIT by hand, since a reserved connection is one session.
      await conn`BEGIN`
      try {
        await conn.unsafe(text)
        await conn`INSERT INTO schema_migrations (name) VALUES (${file})`
        await conn`COMMIT`
      } catch (err) {
        await conn`ROLLBACK`
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
      }
      log(`applied ${file}`)
      applied.push(file)
    }
    log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date')
    return applied
  } finally {
    await conn`SELECT pg_advisory_unlock(hashtext(${LOCK_KEY}))`.catch(() => {})
    conn.release()
  }
}

// Run as a script (npm run db:migrate), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runMigrations()
  } catch (err) {
    console.error((err as Error).message)
    process.exitCode = 1
  } finally {
    await defaultSql.end({ timeout: 5 })
  }
}
