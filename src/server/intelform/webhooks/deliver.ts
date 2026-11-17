import type { Prisma } from '../../../generated/prisma/client'
import type { PrismaClient } from '../../../platform/db'
import { config } from '../../../platform/config'
import { readWebhookConfig } from './config'
import { generateWebhookSecret, newWebhookId, signWebhook } from './sign'
import { assertSafeUrl, WebhookUrlError, type UrlPolicy } from './ssrf'

/**
 * Outbound webhook delivery, on the Worker. ONE way to send, used by both paths:
 *
 *   - real responses: `deliverWebhook` (the notify job's first attempt and the
 *     `intelform-webhook-deliver` retries);
 *   - the builder's "Send test" and "Resend": `runDelivery` (../builder/webhook-delivery.ts).
 *
 * Both call `postSigned`: one signed POST (Standard Webhooks headers, `./sign.ts`) to the form's
 * CURRENT url with its headers and secret; the URL is checked again right before sending
 * (`./ssrf.ts`); `redirect: 'manual'` (a redirect is never followed), a 10 s timeout, the first
 * 1 KB of the answer kept. Every attempt is a row in webhook_deliveries (the builder's log).
 *
 * `deliverWebhook` never throws for a delivery failure: it records it and returns `ok: false`
 * with `retryable` (network error, timeout, 408/425/429/5xx), so the background job can decide
 * to try again. Configuration problems throw `WebhookError`.
 */

export const WEBHOOK_TIMEOUT_MS = 10_000
/** Kept per form in the delivery log; older rows go when a delivery is queued and in the hourly maintenance job. */
export const KEEP_DELIVERIES_PER_FORM = 100
const MAX_BODY_CAPTURE = 1024
const USER_AGENT = 'IntelForm-Webhooks/1'
export const WEBHOOK_OFF = 'The webhook is turned off for this form'

type RawDb = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>

/** A webhook can't be sent as asked. `status` is the HTTP status a route should answer with. */
export class WebhookError extends Error {
  constructor(
    readonly status: 404 | 410 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** The live site: https and public hosts only. Off production (Preview, your machine): http too; your machine: local hosts too. */
export function urlPolicy(): UrlPolicy {
  return { allowHttp: !config.production, allowPrivate: config.localDev }
}

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

/**
 * Returns the form's signing secret, creating one on first use (one statement, so two first
 * sends at once agree on one secret). Null when the form is gone.
 */
export async function ensureWebhookSecret(db: RawDb, formId: string, known?: string | null): Promise<string | null> {
  if (known) return known
  const [row] = await db.$queryRaw<{ secret: string }[]>`
    UPDATE forms SET webhook_secret = COALESCE(webhook_secret, ${generateWebhookSecret()})
    WHERE id = ${formId}::uuid
    RETURNING webhook_secret AS secret`
  return row?.secret ?? null
}

/** Replaces the form's secret and returns the new one (shown to the editor once). Null when the form is gone. */
export async function rotateWebhookSecret(db: RawDb, formId: string): Promise<string | null> {
  const secret = generateWebhookSecret()
  const n = await db.$executeRaw`UPDATE forms SET webhook_secret = ${secret} WHERE id = ${formId}::uuid`
  return n ? secret : null
}

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

/** HTTP statuses worth another try. */
export function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/** A refused URL, a timeout or a network error in words for the delivery log (never a stack). */
export function describeError(err: unknown): string {
  if (err instanceof WebhookUrlError) return err.message
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } } | null
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `Timed out after ${WEBHOOK_TIMEOUT_MS / 1000} seconds`
  const code = e?.cause?.code ?? ''
  const msg = `${String(e?.message ?? '')} ${String(e?.cause?.message ?? '')}`
  // The platform refuses its own internal network (a public name that resolves to it).
  if (/egress blocked/i.test(msg)) return 'Webhooks can’t be sent to that address'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(msg)) return 'The host name could not be found'
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return 'The connection was refused'
  if (code === 'ECONNRESET' || /ECONNRESET/.test(msg)) return 'The connection was closed by the endpoint'
  return 'The endpoint could not be reached'
}

/** The first `max` bytes of a body, as text; the rest is never read. */
export async function readCapped(res: Response, max = MAX_BODY_CAPTURE): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < max) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      size += value.length
    }
  } catch {
    // a truncated body is fine; only the start is kept
  } finally {
    reader.cancel().catch(() => {})
  }
  const all = new Uint8Array(Math.min(size, max))
  let at = 0
  for (const c of chunks) {
    const part = c.subarray(0, all.length - at)
    all.set(part, at)
    at += part.length
    if (at >= all.length) break
  }
  // Cut at a byte boundary may split a character: `fatal: false` turns it into U+FFFD.
  // Postgres text cannot hold NUL: strip it from the stored response body.
  return new TextDecoder('utf-8', { fatal: false }).decode(all).replace(/\0/g, '')
}

export interface SignedPost {
  url: string
  headers: [string, string][]
  secret: string
  webhookId: string
  payload: unknown
}

export interface PostOutcome {
  ok: boolean
  /** Worth trying again later (network error, timeout, 408, 425, 429, 5xx). */
  retryable: boolean
  statusCode: number | null
  durationMs: number
  responseBody: string | null
  error: string | null
}

/**
 * One signed POST. Never throws for the endpoint's failures or a refused URL: they come back as
 * `error` (in words). `policy` and `fetchImpl` are for tests; the default is the running site's.
 */
export async function postSigned(
  msg: SignedPost,
  opts: { fetchImpl?: typeof fetch; policy?: Partial<UrlPolicy> } = {},
): Promise<PostOutcome> {
  const body = JSON.stringify(msg.payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const started = Date.now()
  let statusCode: number | null = null
  let responseBody: string | null = null
  let error: string | null = null
  let retryable = false
  try {
    assertSafeUrl(msg.url, opts.policy ?? urlPolicy())
    const res = await (opts.fetchImpl ?? fetch)(msg.url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...Object.fromEntries(msg.headers),
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'webhook-id': msg.webhookId,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': await signWebhook(msg.secret, msg.webhookId, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    statusCode = res.status
    responseBody = await readCapped(res)
    if (statusCode >= 300 && statusCode < 400) error = 'Redirects are not followed. Use the final URL.'
    else if (statusCode < 200 || statusCode >= 300) {
      error = `The endpoint answered ${statusCode}`
      retryable = retryableStatus(statusCode)
    }
  } catch (err) {
    error = describeError(err)
    retryable = !(err instanceof WebhookUrlError)
  }
  const ok = error === null
  return { ok, retryable: ok ? false : retryable, statusCode, durationMs: Math.max(0, Date.now() - started), responseBody, error }
}

// ---------------------------------------------------------------------------
// Real responses
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  deliveryId: string
  webhookId: string
  ok: boolean
  /** Worth trying again later (network error, timeout, 408, 425, 429, 5xx). */
  retryable: boolean
  statusCode: number | null
  durationMs: number
  error: string | null
}

export interface DeliverOptions {
  /** The response this payload is for; also builds the stable `webhook-id` (`msg_<responseId>`). */
  responseId: string
  /** Tests: the fetch to use. */
  fetchImpl?: typeof fetch
}

/**
 * Sends a response's payload with the form's current URL, headers and secret, and logs it in
 * webhook_deliveries. Throws `WebhookError` when the form is gone, or its webhook has no URL or
 * is turned off.
 */
export async function deliverWebhook(db: PrismaClient, formId: string, payload: unknown, opts: DeliverOptions): Promise<DeliveryResult> {
  const form = await db.form.findUnique({ where: { id: formId }, select: { settings: true, webhookSecret: true } })
  if (!form) throw new WebhookError(404, 'not_found', 'That form no longer exists')
  const cfg = readWebhookConfig(form.settings)
  if (!cfg.url) throw new WebhookError(422, 'webhook_not_configured', 'Add a webhook URL first')
  if (!cfg.enabled) throw new WebhookError(422, 'webhook_disabled', WEBHOOK_OFF)

  const secret = await ensureWebhookSecret(db, formId, form.webhookSecret)
  if (!secret) throw new WebhookError(404, 'not_found', 'That form no longer exists')
  const webhookId = newWebhookId(opts.responseId)
  const out = await postSigned({ url: cfg.url, headers: cfg.headers, secret, webhookId, payload }, { fetchImpl: opts.fetchImpl })

  const deliveryId = await logDelivery(db, {
    formId,
    responseId: opts.responseId,
    url: cfg.url,
    statusCode: out.statusCode,
    durationMs: out.durationMs,
    responseBody: out.responseBody,
    webhookId,
    error: out.error,
    payload,
  })
  return { deliveryId, webhookId, ok: out.ok, retryable: out.retryable, statusCode: out.statusCode, durationMs: out.durationMs, error: out.error }
}

interface DeliveryRow {
  formId: string
  responseId: string
  url: string
  statusCode: number | null
  durationMs: number
  responseBody: string | null
  webhookId: string
  error: string | null
  payload: unknown
}

/**
 * One log row for a real delivery. The row goes with its response (ON DELETE CASCADE). If the
 * response went away while this was in flight, the attempt is logged without the link or the
 * answers, so they don't outlive the response.
 */
async function logDelivery(db: PrismaClient, d: DeliveryRow): Promise<string> {
  const payload = JSON.stringify(d.payload ?? null)
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH r AS (SELECT (SELECT id FROM responses WHERE id = ${d.responseId}::uuid) AS id)
    INSERT INTO webhook_deliveries (form_id, response_id, url, status_code, duration_ms, response_body, is_test, webhook_id, error, payload)
    SELECT ${d.formId}::uuid, r.id, ${d.url.slice(0, 2000)}, ${d.statusCode}::int, ${d.durationMs}::int,
      ${d.responseBody === null ? null : d.responseBody.slice(0, 1024)}, false, ${d.webhookId}, ${d.error === null ? null : d.error.slice(0, 500)},
      CASE WHEN r.id IS NOT NULL THEN ${payload}::jsonb END
    FROM r
    RETURNING id::text AS id
  `
  return rows[0].id
}

/** True when a real (non-test) delivery of this response already succeeded. */
export async function deliveredOnce(db: PrismaClient, responseId: string): Promise<boolean> {
  const row = await db.webhookDelivery.findFirst({
    where: { responseId, isTest: false, error: null },
    select: { id: true },
  })
  return !!row
}

/** Keeps the newest KEEP_DELIVERIES_PER_FORM log rows per form (bounded: 5000 rows a call). */
export async function trimWebhookDeliveries(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    DELETE FROM webhook_deliveries d
    USING (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY form_id ORDER BY created_at DESC, id DESC) AS n FROM webhook_deliveries
      ) ranked WHERE n > ${KEEP_DELIVERIES_PER_FORM}
      LIMIT 5000
    ) old
    WHERE d.id = old.id
  `
}
