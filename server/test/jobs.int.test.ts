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

async function insertResponse(formId: string, versionId: string): Promise<string> {
  const [r] = await ctx.sql<{ id: string }[]>`
    INSERT INTO responses (form_id, form_version_id, answers) VALUES (${formId}, ${versionId}, '{}'::jsonb) RETURNING id
  `
  return r.id
}

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

  it('redacts the payload once a job is done or failed for good, not while it retries', async () => {
    jobs.registerJob('test-secret-ok', async () => {})
    jobs.registerJob('test-secret-fail', async () => {
      throw new Error('boom')
    })
    const secret = { to: ['a@example.com'], text: 'https://app.example/invite/live-token', formId: 'f1', responseId: 'r1' }
    const ok = await jobs.enqueue(ctx.sql, 'test-secret-ok', secret)
    const fail = await jobs.enqueue(ctx.sql, 'test-secret-fail', secret, { maxAttempts: 2 })
    await jobs.drain()
    const payloadOf = async (id: number) => (await ctx.sql`SELECT payload FROM jobs WHERE id = ${id}`)[0].payload
    expect(await payloadOf(ok)).toEqual({ redacted: true, formId: 'f1', responseId: 'r1' })
    // Still retrying: the worker needs the payload.
    expect(await payloadOf(fail)).toEqual(secret)
    await ctx.sql`UPDATE jobs SET run_at = now() WHERE id = ${fail}`
    await jobs.drain()
    expect(await payloadOf(fail)).toEqual({ redacted: true, formId: 'f1', responseId: 'r1' })

    // A job abandoned on its last attempt is redacted when maintenance marks it failed.
    const [abandoned] = await ctx.sql<{ id: number }[]>`
      INSERT INTO jobs (kind, payload, max_attempts, attempts, locked_until)
      VALUES ('test-secret-abandoned', ${ctx.sql.json({ text: 'reset link', formId: 'f2' })}, 1, 1, now() - interval '1 minute')
      RETURNING id
    `
    await jobs.failAbandonedJobs()
    expect(await payloadOf(abandoned.id)).toEqual({ redacted: true, formId: 'f2' })
  })

  it('an invite email job keeps no link once sent', async () => {
    const email = await import('../lib/email')
    const sent: string[] = []
    email.setTestEmailDriver({ send: async (m) => (sent.push(m.text), {}), verify: async () => {} })
    try {
      await ctx.sql.begin((tx) => email.queueEmail(tx, { to: 'new@example.com', subject: 'Join', text: 'https://app.example/invite/tok_abc123' }))
      await jobs.drain()
      expect(sent.at(-1)).toContain('tok_abc123')
      const [job] = await ctx.sql`SELECT payload, done_at FROM jobs WHERE kind = 'email' ORDER BY id DESC LIMIT 1`
      expect(job.done_at).not.toBeNull()
      expect(JSON.stringify(job.payload)).not.toContain('tok_abc123')
      expect(job.payload).toEqual({ redacted: true })
    } finally {
      email.setTestEmailDriver(undefined)
    }
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
    const responseId = await insertResponse(form.id, form.versionId)
    const payload = { type: 'form.response', data: { answers: { q1: 'Yes' } } }
    const result = await webhooks.deliverWebhook(form.id, payload, { responseId })
    expect(result).toMatchObject({ ok: true, statusCode: 200, webhookId: `msg_${responseId}` })
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
    const responseId = await insertResponse(form.id, form.versionId)
    await ctx.sql.begin((tx) => webhooks.queueWebhook(tx, form.id, responseId, { ok: true }))
    await jobs.drain()
    const [d] = await ctx.sql`SELECT webhook_id, status_code FROM webhook_deliveries WHERE form_id = ${form.id}`
    expect(d).toMatchObject({ webhook_id: `msg_${responseId}`, status_code: 200 })
    const [j] = await ctx.sql`SELECT max_attempts, payload FROM jobs WHERE kind = 'webhook' ORDER BY id DESC LIMIT 1`
    expect(j.max_attempts).toBe(1)
    expect(j.payload).toEqual({ redacted: true, formId: form.id, responseId })
  })

  it('deleting a response deletes its deliveries; a deleted response is never sent', async () => {
    const form = await insertForm(ctx.sql, { settings: { webhook: { url: `${base}/hook` } } })
    const responseId = await insertResponse(form.id, form.versionId)
    const sent = await webhooks.deliverWebhook(form.id, { answers: { q: 'private' } }, { responseId })
    const test = await webhooks.deliverWebhook(form.id, { answers: { q: 'sample' } }, { test: true })
    await ctx.sql`DELETE FROM responses WHERE id = ${responseId}`
    const left = await ctx.sql<{ id: string }[]>`SELECT id FROM webhook_deliveries WHERE form_id = ${form.id}`
    expect(left.map((r) => r.id)).toEqual([test.deliveryId])

    // Queued, then the response is deleted before the worker runs: nothing goes out.
    const doomed = await insertResponse(form.id, form.versionId)
    await ctx.sql.begin((tx) => webhooks.queueWebhook(tx, form.id, doomed, { answers: { q: 'private' } }))
    await ctx.sql`DELETE FROM responses WHERE id = ${doomed}`
    const before = received.length
    await jobs.drain()
    expect(received.length).toBe(before)
    expect(await ctx.sql`SELECT 1 FROM webhook_deliveries WHERE webhook_id = ${'msg_' + doomed}`).toHaveLength(0)

    // A row orphaned before 0007 (response_id NULL, not a test) can't be resent.
    const [orphan] = await ctx.sql<{ id: string }[]>`
      INSERT INTO webhook_deliveries (form_id, url, webhook_id, payload) VALUES (${form.id}, ${base + '/hook'}, ${'msg_' + sent.deliveryId}, ${ctx.sql.json({ q: 'private' })})
      RETURNING id
    `
    await expect(webhooks.resendDelivery(orphan.id)).rejects.toMatchObject({ status: 410 })
    expect(received.length).toBe(before)
  })
})
