import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insertForm, setupTestDb, type TestContext } from './harness'
import { verifyStandardWebhook } from './standard-webhooks'

let ctx: TestContext
let jobs: typeof import('../lib/jobs')
let scheduler: typeof import('../lib/scheduler')
let webhooks: typeof import('../lib/webhooks')

// Local receiver for webhook deliveries (private address: allowed via ALLOW_PRIVATE_WEBHOOKS in this file).
let server: Server
let base = ''
const received: { headers: IncomingMessage['headers']; body: string; path: string }[] = []

beforeAll(async () => {
  ctx = await setupTestDb({ ALLOW_PRIVATE_WEBHOOKS: '1' })
  jobs = await import('../lib/jobs')
  scheduler = await import('../lib/scheduler')
  webhooks = await import('../lib/webhooks')
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ headers: req.headers, body, path: req.url ?? '' })
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://example.com/' }).end()
      } else if (req.url === '/big') {
        res.writeHead(200).end('y'.repeat(5000))
      } else if (req.url === '/fail') {
        res.writeHead(500).end('nope')
      } else res.writeHead(200).end('thanks')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)
afterAll(async () => {
  server?.close()
  await ctx?.teardown()
})

describe('jobs', () => {
  it('a rolled-back transaction leaves no job', async () => {
    let ran = 0
    jobs.registerJob('test-rollback', async () => void ran++)
    await ctx.sql
      .begin(async (tx) => {
        await jobs.enqueue(tx, 'test-rollback', { a: 1 })
        throw new Error('rollback')
      })
      .catch(() => {})
    await jobs.drain()
    expect(ran).toBe(0)
    expect(await ctx.sql`SELECT 1 FROM jobs WHERE kind = 'test-rollback'`).toHaveLength(0)
  })

  it('runs committed jobs once, at most 4 at a time', async () => {
    let running = 0
    let peak = 0
    const seen: number[] = []
    jobs.registerJob<{ n: number }>('test-run', async ({ n }) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 20))
      seen.push(n)
      running--
    })
    await ctx.sql.begin(async (tx) => {
      for (let n = 0; n < 10; n++) await jobs.enqueue(tx, 'test-run', { n })
    })
    await Promise.all([jobs.drain(), jobs.drain()])
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(peak).toBeLessThanOrEqual(4)
    const [{ n }] = await ctx.sql`SELECT count(*)::int AS n FROM jobs WHERE kind = 'test-run' AND done_at IS NOT NULL`
    expect(n).toBe(10)
  })

  it('retries with backoff, then marks the job failed', async () => {
    let calls = 0
    jobs.registerJob('test-fail', async () => {
      calls++
      throw new Error('boom')
    })
    const id = await jobs.enqueue(ctx.sql, 'test-fail', {}, { maxAttempts: 2 })
    await jobs.drain()
    let [row] = await ctx.sql`SELECT attempts, last_error, failed_at, run_at > now() AS later FROM jobs WHERE id = ${id}`
    expect(row).toMatchObject({ attempts: 1, last_error: 'boom', failed_at: null, later: true })
    await ctx.sql`UPDATE jobs SET run_at = now() WHERE id = ${id}`
    await jobs.drain()
    ;[row] = await ctx.sql`SELECT attempts, failed_at FROM jobs WHERE id = ${id}`
    expect(row.attempts).toBe(2)
    expect(row.failed_at).not.toBeNull()
    await ctx.sql`UPDATE jobs SET run_at = now() WHERE id = ${id}`
    await jobs.drain()
    expect(calls).toBe(2)
  })
})

describe('scheduler', () => {
  it('closes Live forms past settings.closeAt, ignoring bad dates', async () => {
    const past = await insertForm(ctx.sql, { settings: { closeAt: '2020-01-01T00:00:00Z' } })
    const future = await insertForm(ctx.sql, { settings: { closeAt: '2999-01-01T00:00:00Z' } })
    const garbage = await insertForm(ctx.sql, { settings: { closeAt: 'not a date' } })
    const none = await insertForm(ctx.sql)
    expect(await scheduler.closeExpiredForms()).toBe(1)
    const rows = await ctx.sql<{ id: string; status: string }[]>`SELECT id, status FROM forms WHERE id IN ${ctx.sql([past.id, future.id, garbage.id, none.id])}`
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]))
    expect(status[past.id]).toBe('closed')
    expect(status[future.id]).toBe('live')
    expect(status[garbage.id]).toBe('live')
    expect(status[none.id]).toBe('live')
  })

  it('retention deletes old responses only when data.retentionDays is set', async () => {
    const form = await insertForm(ctx.sql)
    await ctx.sql`
      INSERT INTO responses (form_id, form_version_id, answers, submitted_at)
      SELECT ${form.id}, ${form.versionId}, '{}'::jsonb, now() - make_interval(days => d) + interval '1 hour' FROM generate_series(1, 40) d
    `
    expect(await scheduler.applyRetention()).toBe(0)
    const { setSetting } = await import('../lib/settings')
    await setSetting('data', { retentionDays: 30 })
    expect(await scheduler.applyRetention()).toBe(10)
    await setSetting('data', { retentionDays: null })
  })

  it('hourly maintenance purges expired rows and keeps 100 deliveries per form', async () => {
    const form = await insertForm(ctx.sql)
    await ctx.sql`
      INSERT INTO webhook_deliveries (form_id, url, created_at)
      SELECT ${form.id}, 'https://example.com', now() - make_interval(secs => n) FROM generate_series(1, 120) n
    `
    await ctx.sql`INSERT INTO rate_limits (key, window_start, window_seconds, count) VALUES ('old', now() - interval '2 hours', 60, 1)`
    await ctx.sql`INSERT INTO jobs (kind, done_at) VALUES ('old', now() - interval '8 days')`
    const result = await scheduler.hourlyMaintenance()
    expect(result.webhookDeliveries).toBe(20)
    expect(result.rateLimits).toBeGreaterThanOrEqual(1)
    expect(result.jobs).toBeGreaterThanOrEqual(1)
    const [{ n }] = await ctx.sql`SELECT count(*)::int AS n FROM webhook_deliveries WHERE form_id = ${form.id}`
    expect(n).toBe(100)
  })

  it('a lease tick runs once even when two instances race', async () => {
    await ctx.sql`DELETE FROM scheduler`
    await Promise.all([scheduler.tick(), scheduler.tick()])
    const rows = await ctx.sql`SELECT name, next_run_at > now() AS leased FROM scheduler ORDER BY name`
    expect(rows.map((r) => r.name)).toEqual(['close-forms', 'form-events', 'maintenance'])
    expect(rows.every((r) => r.leased)).toBe(true)
  })
})

describe('webhook delivery', () => {
  it('signs per Standard Webhooks and logs the delivery', async () => {
    const form = await insertForm(ctx.sql, { settings: { webhook: { enabled: true, url: `${base}/hook`, headers: [{ key: 'X-Team', value: 'forms' }, { key: 'Host', value: 'evil' }] } } })
    const payload = { type: 'form.response', data: { answers: { q1: 'Yes' } } }
    const result = await webhooks.deliverWebhook(form.id, payload, { responseId: '11111111-1111-4111-8111-111111111111' })
    expect(result).toMatchObject({ ok: true, statusCode: 200, webhookId: 'msg_11111111-1111-4111-8111-111111111111' })
    const hit = received.at(-1)!
    expect(hit.headers['x-team']).toBe('forms')
    expect(hit.headers.host).not.toBe('evil')
    expect(hit.headers['user-agent']).toBe('IntelForm-Webhooks/1')
    const secret = await webhooks.ensureWebhookSecret(form.id)
    expect(secret).toMatch(/^whsec_/)
    expect(verifyStandardWebhook(secret, hit.headers as Record<string, string>, hit.body)).toEqual(payload)

    const [row] = await ctx.sql`SELECT status_code, response_body, webhook_id, error, payload FROM webhook_deliveries WHERE id = ${result.deliveryId}`
    expect(row).toMatchObject({ status_code: 200, response_body: 'thanks', webhook_id: result.webhookId, error: null, payload })
    const [stored] = await ctx.sql`SELECT webhook_secret FROM forms WHERE id = ${form.id}`
    expect(stored.webhook_secret).toMatch(/^v2\./)
  })

  it('resend keeps the webhook-id with a fresh signature', async () => {
    const form = await insertForm(ctx.sql, { settings: { webhook: { url: `${base}/hook` } } })
    const first = await webhooks.deliverWebhook(form.id, { n: 1 }, { test: true })
    expect(first.webhookId).toMatch(/^msg_test_/)
    const again = await webhooks.resendDelivery(first.deliveryId)
    expect(again.webhookId).toBe(first.webhookId)
    expect(again.deliveryId).not.toBe(first.deliveryId)
  })

  it('records failures: non-2xx, redirects (not followed) and caps the body at 1 KB', async () => {
    const form = await insertForm(ctx.sql, { settings: { webhook: { url: `${base}/fail` } } })
    const fail = await webhooks.deliverWebhook(form.id, {}, { test: true })
    expect(fail).toMatchObject({ ok: false, statusCode: 500 })
    const before = received.length
    const redirect = await webhooks.deliverWebhook(form.id, {}, { test: true, url: `${base}/redirect` })
    expect(redirect.ok).toBe(false)
    expect(redirect.statusCode).toBe(302)
    expect(received.length).toBe(before + 1) // example.com was never called
    const big = await webhooks.deliverWebhook(form.id, {}, { test: true, url: `${base}/big` })
    const [row] = await ctx.sql`SELECT length(response_body) AS n FROM webhook_deliveries WHERE id = ${big.deliveryId}`
    expect(row.n).toBe(1024)
  })

  it('the webhook job delivers after commit with one attempt', async () => {
    const form = await insertForm(ctx.sql, { settings: { webhook: { url: `${base}/hook` } } })
    await ctx.sql.begin((tx) => webhooks.queueWebhook(tx, form.id, '22222222-2222-4222-8222-222222222222', { ok: true }))
    await jobs.drain()
    const [d] = await ctx.sql`SELECT webhook_id, status_code FROM webhook_deliveries WHERE form_id = ${form.id}`
    expect(d).toMatchObject({ webhook_id: 'msg_22222222-2222-4222-8222-222222222222', status_code: 200 })
    const [j] = await ctx.sql`SELECT max_attempts FROM jobs WHERE kind = 'webhook' ORDER BY id DESC LIMIT 1`
    expect(j.max_attempts).toBe(1)
  })
})
