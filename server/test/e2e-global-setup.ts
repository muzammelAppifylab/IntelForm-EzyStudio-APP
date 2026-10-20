import postgres from 'postgres'

/**
 * Drops and recreates the e2e database so every Playwright run starts on a fresh install.
 * Run by the web server command in playwright.config.ts, before `npm start` (which applies
 * migrations itself with MIGRATE_ON_BOOT=1).
 */
export default async function resetE2eDatabase() {
  const url = new URL(process.env.E2E_DATABASE_URL || 'postgres://intelform:intelform@localhost:5433/intelform_c_e2e')
  const db = url.pathname.slice(1)
  if (!/^[a-z0-9_]+$/.test(db) || !db.includes('e2e')) throw new Error(`Refusing to recreate "${db}": the e2e database name must contain "e2e"`)
  url.pathname = '/postgres'
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)
    await admin.unsafe(`CREATE DATABASE "${db}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }
}

await resetE2eDatabase()
