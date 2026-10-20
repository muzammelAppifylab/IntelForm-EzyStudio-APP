import { readFileSync } from 'node:fs'
import { checkServerIdentity, type ConnectionOptions } from 'node:tls'
import postgres, { type ReservedSql, type TransactionSql } from 'postgres'
import { env, isProduction } from '../env'

export type SslMode = 'off' | 'require' | 'verify-full'

/**
 * The postgres.js `ssl` option for DATABASE_SSL / DATABASE_CA, or undefined to leave it to
 * DATABASE_URL (?sslmode=…). Unset DATABASE_SSL means off in development and `require` in
 * production, unless the URL names an sslmode itself or the database is on loopback
 * (localhost, 127.0.0.1, ::1: local production-mode runs such as the e2e suite).
 *
 * verify-full checks the certificate chain (DATABASE_CA, or the system CAs) and that the
 * certificate matches the host in DATABASE_URL, also when the host is an IP address.
 */
export function resolveSsl(
  opts: { url: string; mode?: SslMode; caPath?: string; production: boolean },
  readCa: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): false | 'require' | ConnectionOptions | undefined {
  const url = new URL(opts.url)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const urlDecides = ['sslmode', 'ssl', 'sslrootcert'].some((k) => url.searchParams.has(k))
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host)
  const mode = opts.mode ?? (urlDecides ? undefined : opts.production && !loopback ? 'require' : 'off')
  if (mode === undefined) return undefined
  if (mode === 'off') return false
  if (mode === 'require') return 'require'
  return {
    rejectUnauthorized: true,
    ...(opts.caPath ? { ca: readCa(opts.caPath) } : {}),
    checkServerIdentity: (_servername, cert) => checkServerIdentity(host, cert),
  }
}

const ssl = resolveSsl({ url: env.DATABASE_URL, mode: env.DATABASE_SSL, caPath: env.DATABASE_CA, production: isProduction })

/**
 * One shared connection pool. Always use the tagged template (sql`... ${value}`): values are
 * sent as parameters, never spliced into SQL text.
 *
 * statement_timeout (DATABASE_STATEMENT_TIMEOUT_MS, default 30 s) is a startup parameter, so a
 * runaway query can't hold a connection forever. A cursor counts as ONE statement from the
 * first fetch to the last (Postgres only stops the timer when the portal completes), so a
 * streamed export that waits on a slow client would be cut off: stream through
 * `withoutStatementTimeout`. Migrations and secrets:reencrypt lift the timeout the same way.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  onnotice: () => {},
  transform: { undefined: null },
  // Only when set: an explicit `ssl` would override ?sslmode= in the URL.
  ...(ssl === undefined ? {} : { ssl }),
  connection: {
    // JIT misfires on jsonb_each / LATERAL summary queries (+0.3–0.6 s measured): keep it off.
    jit: 'off',
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  },
})

export type Sql = typeof sql

/**
 * Streams `gen` on a reserved connection with statement_timeout off, for long cursors (CSV and
 * ZIP exports). The timeout is reset and the connection released when the stream ends, fails
 * or is closed early (the consumer breaks out, or the HTTP client goes away).
 *
 *   yield* withoutStatementTimeout(async function* (db) {
 *     for await (const rows of db`SELECT …`.cursor(500)) yield rows
 *   })
 */
export async function* withoutStatementTimeout<T>(gen: (db: ReservedSql) => AsyncIterable<T>, pool: Sql = sql): AsyncGenerator<T> {
  const db = await pool.reserve()
  try {
    await db`SET statement_timeout = 0`
    yield* gen(db)
  } finally {
    await db`RESET statement_timeout`.catch(() => {})
    db.release()
  }
}
/** The pool or an open transaction: helpers that accept either can join the caller's transaction. */
export type Queryable = Sql | TransactionSql
