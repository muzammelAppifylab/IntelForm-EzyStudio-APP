import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent, request } from 'undici'
import { sql, type Queryable } from '../db/client'
import { env } from '../env'
import { decryptSecret, encryptSecret } from './crypto'
import { ApiError, notFound } from './errors'
import { enqueue, registerJob } from './jobs'
import { logger } from './logger'

/**
 * Outbound webhooks, signed per the Standard Webhooks spec (https://www.standardwebhooks.com),
 * so receivers can verify with the `standardwebhooks` libraries:
 *
 *   webhook-id:        msg_<responseId> (msg_test_<uuid> for tests); unchanged on Resend
 *   webhook-timestamp: unix seconds
 *   webhook-signature: v1,<base64 HMAC-SHA256(key, id.timestamp.body)>
 *
 * The secret is `whsec_` + base64(32 random bytes), per form, stored encrypted in
 * forms.webhook_secret. Only https in production (http too in development, for local
 * receivers). SSRF: every resolved address is checked inside the socket's DNS lookup (so DNS
 * rebinding can't swap in a private IP after the check).
 *
 * Form config is read from forms.settings.webhook (owned by Agent D):
 *   { enabled?: boolean, url: string, headers?: {key,value}[] | Record<string,string> }
 */

export const WEBHOOK_TIMEOUT_MS = 10_000
const MAX_BODY_CAPTURE = 1024
const KEEP_PER_FORM = 100

// ---------------------------------------------------------------------------
// Secrets and signing
// ---------------------------------------------------------------------------

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`
}

function secretKey(secret: string): Buffer {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
}

/** The `webhook-signature` header value for one message. */
export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest('base64')
  return `v1,${mac}`
}

/** Returns the form's secret, creating one on first use. */
export async function ensureWebhookSecret(formId: string, tx: Queryable = sql): Promise<string> {
  const [row] = await tx<{ webhook_secret: string | null }[]>`SELECT webhook_secret FROM forms WHERE id = ${formId}`
  if (!row) throw notFound('That form no longer exists')
  if (row.webhook_secret) return decryptSecret(row.webhook_secret)
  return rotateWebhookSecret(formId, tx)
}

/** Replaces the form's secret and returns the new one (shown to the creator once). */
export async function rotateWebhookSecret(formId: string, tx: Queryable = sql): Promise<string> {
  const secret = generateWebhookSecret()
  await tx`UPDATE forms SET webhook_secret = ${encryptSecret(secret)} WHERE id = ${formId}`
  return secret
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

// Two lists: BlockList also matches IPv4 against IPv6 rules (via ::ffff:a.b.c.d), so one
// shared list with ::ffff:0:0/96 would block every IPv4 address.
const blocked4 = new BlockList()
const blocked6 = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked4.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback and the deprecated IPv4-compatible ::a.b.c.d
  ['fec0::', 10], // deprecated site-local
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link local
  ['ff00::', 8], // multicast
] as const)
  blocked6.addSubnet(net, prefix, 'ipv6')

/** True for loopback, private, link-local, CGNAT, metadata, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blocked4.check(address, 'ipv4')
  if (family === 6) {
    const lower = address.toLowerCase()
    // ::ffff:a.b.c.d written in dotted form: judge the embedded IPv4 too.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return true
    return blocked6.check(lower, 'ipv6')
  }
  return true
}

const allowPrivate = () => env.ALLOW_PRIVATE_WEBHOOKS
/** Plain http only off production (local receivers) or with ALLOW_PRIVATE_WEBHOOKS: answers must travel encrypted. */
const allowHttp = () => env.NODE_ENV !== 'production' || env.ALLOW_PRIVATE_WEBHOOKS

export const HTTPS_REQUIRED = 'Use an https:// address. Webhooks carry answers, so plain http:// isn’t allowed.'

/** Validates a webhook URL before saving or sending. Throws a 422 ApiError with a readable message. */
export function assertSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalidUrl('Enter a full URL starting with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalidUrl('Use an https:// address')
  // Checked again at send time, so an http URL saved before this rule is refused and logged.
  if (url.protocol === 'http:' && !allowHttp()) throw invalidUrl(HTTPS_REQUIRED)
  if (url.username || url.password) throw invalidUrl('Remove the user name and password from the URL; use a custom header instead')
  if (raw.length > 2048) throw invalidUrl('Use a shorter URL')
  // "localhost." and "db.internal." are the same names as without the final dot.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!allowPrivate()) {
    if (!host) throw invalidUrl('Enter a full URL starting with https://')
    if (isIP(host) && isPrivateAddress(host)) throw invalidUrl('Webhooks can’t be sent to private or local network addresses')
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw invalidUrl('Webhooks can’t be sent to local host names')
  }
  return url
}

function invalidUrl(message: string) {
  return new ApiError(422, 'validation_failed', message, { url: [message] })
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** dns.lookup replacement for the socket: resolves, then refuses if any address is private. */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number | string } | number, callback: LookupCallback): void {
  const opts = typeof options === 'number' ? { family: options } : options
  dnsLookup(hostname, { all: true, family: (opts.family as 0 | 4 | 6 | undefined) ?? 0 }, (err, addresses) => {
    if (err) return callback(err, [])
    const list = addresses as LookupAddress[]
    if (!allowPrivate()) {
      const bad = list.find((a) => isPrivateAddress(a.address))
      if (bad || !list.length) {
        const e = new Error(`Refused to connect to ${hostname}: it resolves to a private or local address`) as NodeJS.ErrnoException
        e.code = 'EPRIVATEADDR'
        return callback(e, [])
      }
    }
    if (opts.all) callback(null, list)
    else callback(null, list[0].address, list[0].family)
  })
}

const agent = new Agent({
  connect: { lookup: safeLookup as never, timeout: WEBHOOK_TIMEOUT_MS },
  headersTimeout: WEBHOOK_TIMEOUT_MS,
  bodyTimeout: WEBHOOK_TIMEOUT_MS,
})

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

interface WebhookConfig {
  enabled: boolean
  url: string | null
  headers: [string, string][]
}

const RESERVED = /^(host|content-length|content-type|transfer-encoding|connection|user-agent|webhook-.*)$/i

export function readWebhookConfig(settings: unknown): WebhookConfig {
  const w = (settings as { webhook?: Record<string, unknown> } | null)?.webhook ?? {}
  const url = typeof w.url === 'string' && w.url.trim() ? w.url.trim() : null
  const raw = w.headers
  const headers: [string, string][] = []
  if (Array.isArray(raw)) {
    for (const h of raw as Record<string, unknown>[]) {
      const k = String(h?.key ?? h?.name ?? '').trim()
      if (k) headers.push([k, String(h?.value ?? '')])
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (k.trim()) headers.push([k.trim(), String(v ?? '')])
  }
  return {
    enabled: w.enabled !== false && !!url,
    url,
    headers: headers.filter(([k, v]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) && !RESERVED.test(k) && !/[\r\n]/.test(v)).slice(0, 20),
  }
}

export interface DeliveryResult {
  deliveryId: string
  webhookId: string
  ok: boolean
  statusCode: number | null
  durationMs: number
  error: string | null
}

export interface DeliverOptions {
  test?: boolean
  /** The response this payload is for; also builds the stable `webhook-id`. */
  responseId?: string | null
  /** Reuse an id (Resend keeps the original so receivers can dedupe). */
  webhookId?: string
  /** Override the form's configured URL (Resend of an old delivery when the URL was removed). */
  url?: string
}

/**
 * Sends one signed POST with the form's current URL, headers and secret, and logs it in
 * webhook_deliveries. Never throws for delivery failures: they're recorded and returned.
 */
export async function deliverWebhook(formId: string, payload: unknown, opts: DeliverOptions = {}): Promise<DeliveryResult> {
  const [form] = await sql<{ settings: unknown }[]>`SELECT settings FROM forms WHERE id = ${formId}`
  if (!form) throw notFound('That form no longer exists')
  const cfg = readWebhookConfig(form.settings)
  const url = opts.url ?? cfg.url
  if (!url) throw new ApiError(422, 'webhook_not_configured', 'Add a webhook URL first')
  if (!opts.test && !opts.url && !cfg.enabled) throw new ApiError(422, 'webhook_disabled', 'The webhook is turned off for this form')

  const secret = await ensureWebhookSecret(formId)
  const webhookId = opts.webhookId ?? (opts.test || !opts.responseId ? `msg_test_${randomUUID()}` : `msg_${opts.responseId}`)
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)

  const started = performance.now()
  let statusCode: number | null = null
  let captured: string | null = null
  let error: string | null = null
  try {
    assertSafeUrl(url)
    const res = await request(url, {
      method: 'POST',
      dispatcher: agent,
      headers: {
        ...Object.fromEntries(cfg.headers),
        'content-type': 'application/json',
        'user-agent': 'IntelForm-Webhooks/1',
        'webhook-id': webhookId,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signWebhook(secret, webhookId, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    statusCode = res.statusCode
    captured = await readCapped(res.body)
    if (statusCode >= 300 && statusCode < 400) error = 'Redirects are not followed. Use the final URL.'
    else if (statusCode < 200 || statusCode >= 300) error = `The endpoint answered ${statusCode}`
  } catch (err) {
    error = describeError(err)
  }
  const durationMs = Math.round(performance.now() - started)
  const ok = error === null

  // The log row is deleted with its response (ON DELETE CASCADE, 0007_privacy.sql). If the
  // response went away while this was in flight, log the attempt without the link or the
  // answers, so they don't outlive the response. Test sends carry sample answers only.
  const [row] = await sql<{ id: string }[]>`
    WITH r AS (SELECT (SELECT id FROM responses WHERE id = ${opts.responseId ?? null}::uuid) AS id)
    INSERT INTO webhook_deliveries (form_id, response_id, url, status_code, duration_ms, response_body, is_test, webhook_id, error, payload)
    SELECT ${formId}, r.id, ${url}, ${statusCode}, ${durationMs}, ${captured}, ${!!opts.test}, ${webhookId}, ${error},
      CASE WHEN ${!!opts.test} OR r.id IS NOT NULL THEN ${sql.json(payload as never)}::jsonb END
    FROM r
    RETURNING id
  `
  return { deliveryId: row.id, webhookId, ok, statusCode, durationMs, error }
}

async function readCapped(body: AsyncIterable<Buffer> & { destroy?: (err?: Error) => void }): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of body) {
      chunks.push(chunk)
      size += chunk.length
      if (size >= MAX_BODY_CAPTURE) break
    }
  } catch {
    // a truncated body is fine; we only keep the start
  } finally {
    body.destroy?.()
  }
  return Buffer.concat(chunks).subarray(0, MAX_BODY_CAPTURE).toString('utf8')
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }
  const code = e?.code ?? e?.cause?.code
  if (code === 'EPRIVATEADDR' || e?.cause?.code === 'EPRIVATEADDR') return (e.cause ?? e).message
  if (e?.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return 'Timed out after 10 seconds'
  if (code === 'ENOTFOUND') return 'The host name could not be found'
  if (code === 'ECONNREFUSED') return 'The connection was refused'
  return (e?.message ?? String(err)).slice(0, 300)
}

/**
 * Sends a logged delivery again: same payload and webhook-id, fresh timestamp and signature.
 * A real delivery whose response was deleted is refused: its answers must not go out again.
 */
export async function resendDelivery(deliveryId: string): Promise<DeliveryResult> {
  const [d] = await sql<{ form_id: string; response_id: string | null; payload: unknown; webhook_id: string | null; is_test: boolean; url: string }[]>`
    SELECT form_id, response_id, payload, webhook_id, is_test, url FROM webhook_deliveries WHERE id = ${deliveryId}
  `
  if (!d || d.payload === null) throw notFound('That delivery is no longer in the log')
  if (!d.is_test) {
    const [response] = d.response_id ? await sql`SELECT 1 FROM responses WHERE id = ${d.response_id}` : []
    if (!response) throw new ApiError(410, 'response_deleted', 'That response was deleted, so its webhook can’t be resent')
  }
  const [form] = await sql<{ settings: unknown }[]>`SELECT settings FROM forms WHERE id = ${d.form_id}`
  const current = form ? readWebhookConfig(form.settings).url : null
  return deliverWebhook(d.form_id, d.payload, {
    test: d.is_test,
    responseId: d.response_id,
    webhookId: d.webhook_id ?? undefined,
    url: current ? undefined : d.url,
  })
}

/** Queues a delivery in the submit transaction (1 attempt, PRD: no automatic retries). */
export async function queueWebhook(tx: Queryable, formId: string, responseId: string, payload: unknown): Promise<void> {
  await enqueue(tx, 'webhook', { formId, responseId, payload }, { maxAttempts: 1 })
}

registerJob<{ formId: string; responseId: string; payload: unknown }>('webhook', async ({ formId, responseId, payload }) => {
  // Response deleted (by hand or retention) since the job was queued: don't send its answers.
  const [response] = await sql`SELECT 1 FROM responses WHERE id = ${responseId}::uuid`
  if (!response) return
  const result = await deliverWebhook(formId, payload, { responseId }).catch((err: unknown) => {
    // Form deleted or webhook switched off since the job was queued: nothing to do.
    if (err instanceof ApiError) return null
    throw err
  })
  if (result && !result.ok) logger.info({ formId, deliveryId: result.deliveryId, error: result.error }, 'webhook delivery failed')
})

/** Keeps the newest 100 log rows per form. Called by the hourly maintenance task. */
export async function trimWebhookDeliveries(): Promise<number> {
  const rows = await sql`
    DELETE FROM webhook_deliveries d
    USING (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY form_id ORDER BY created_at DESC) AS n FROM webhook_deliveries
      ) ranked WHERE n > ${KEEP_PER_FORM}
    ) old
    WHERE d.id = old.id
  `
  return rows.count
}
