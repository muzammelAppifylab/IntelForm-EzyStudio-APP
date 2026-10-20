import { setTimeout as sleep } from 'node:timers/promises'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestDb, type TestContext } from '../test/harness'

let ctx: TestContext
beforeAll(async () => {
  ctx = await setupTestDb()

}, 60_000)
afterAll(() => ctx?.teardown())

describe('DATABASE_SSL', () => {
  const remote = 'postgres://u:p@db.example.com:5432/app'
  const readCa = () => 'PEM'

  it('defaults to off in development and require in production, unless the URL or loopback decides', async () => {
    const { resolveSsl } = await import('./client')
    expect(resolveSsl({ url: remote, production: false })).toBe(false)
    expect(resolveSsl({ url: remote, production: true })).toBe('require')
    expect(resolveSsl({ url: `${remote}?sslmode=verify-full`, production: true })).toBeUndefined()
    expect(resolveSsl({ url: 'postgres://u:p@localhost:5433/app', production: true })).toBe(false)
    expect(resolveSsl({ url: 'postgres://u:p@127.0.0.1/app', production: true })).toBe(false)
    expect(resolveSsl({ url: remote, mode: 'off', production: true })).toBe(false)
    expect(resolveSsl({ url: 'postgres://u:p@localhost/app', mode: 'require', production: false })).toBe('require')
  })

  it('verify-full checks the chain against DATABASE_CA and the host in the URL', async () => {
    const { resolveSsl } = await import('./client')
    const opts = resolveSsl({ url: remote, mode: 'verify-full', caPath: '/ca.pem', production: true }, readCa)
    expect(opts).toMatchObject({ rejectUnauthorized: true, ca: 'PEM' })
    const check = (opts as { checkServerIdentity: (host: string, cert: object) => Error | undefined }).checkServerIdentity
    const cert = (cn: string) => ({ subject: { CN: cn }, subjectaltname: `DNS:${cn}` })
    expect(check('ignored', cert('db.example.com'))).toBeUndefined()
    expect(check('db.example.com', cert('evil.example.com'))).toBeInstanceOf(Error)
    const ip = resolveSsl({ url: 'postgres://u:p@10.0.0.7/app', mode: 'verify-full', production: true }, readCa) as { ca?: string; checkServerIdentity: typeof check }
    expect(ip.ca).toBeUndefined()
    expect(ip.checkServerIdentity('', { subject: {}, subjectaltname: 'IP Address:10.0.0.7' })).toBeUndefined()
    expect(ip.checkServerIdentity('', { subject: {}, subjectaltname: 'IP Address:10.0.0.8' })).toBeInstanceOf(Error)
  })
})

describe('statement_timeout', () => {
  it('the pool sets DATABASE_STATEMENT_TIMEOUT_MS (default 30 s)', async () => {
    const [row] = await ctx.sql<{ statement_timeout: string }[]>`SHOW statement_timeout`
    expect(row.statement_timeout).toBe('30s')
  })

  it('a cursor is one statement for its whole life; withoutStatementTimeout lets a slow export finish; migrations restore it', async () => {
    const { withoutStatementTimeout } = await import('./client')
    const short = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {}, connection: { statement_timeout: 300 } })
    // Like the CSV/ZIP exports: the consumer is slower than the timeout between batches.
    const slowRead = async (batches: AsyncIterable<unknown[]>) => {
      let rows = 0
      for await (const batch of batches) {
        rows += batch.length
        await sleep(200)
      }
      return rows
    }
    const series = (db: typeof short | import('postgres').ReservedSql) => db`SELECT g FROM generate_series(1, 40) g`.cursor(10)
    try {
      await expect(short`SELECT pg_sleep(0.6)`).rejects.toMatchObject({ code: '57014' })
      await expect(slowRead(series(short))).rejects.toMatchObject({ code: '57014' })

      const started = Date.now()
      expect(await slowRead(withoutStatementTimeout((db) => series(db), short as never))).toBe(40)
      expect(Date.now() - started).toBeGreaterThan(600)
      // The connection went back to the pool with the timeout restored.
      await expect(short`SELECT pg_sleep(0.6)`).rejects.toMatchObject({ code: '57014' })

      const { runMigrations } = await import('./migrate')
      await runMigrations(short as never, () => {})
      const [row] = await short<{ statement_timeout: string }[]>`SHOW statement_timeout`
      expect(row.statement_timeout).toBe('300ms')
    } finally {
      await short.end({ timeout: 5 })
    }
  }, 20_000)
})
