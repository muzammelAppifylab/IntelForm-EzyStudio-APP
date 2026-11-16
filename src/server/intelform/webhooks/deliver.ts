import type { PrismaClient } from '../../../platform/db'
import { config } from '../../../platform/config'
import { readWebhookConfig } from './config'
import { generateWebhookSecret, signWebhook } from './sign'
import { assertSafeUrl, WebhookUrlError, type UrlPolicy } from './ssrf'

/**
 * Outbound webhook delivery (legacy server/lib/webhooks.ts), on the Worker:
 *   - one signed POST (Standard Webhooks headers, `./sign.ts`) with the form's CURRENT url,
 *     headers and secret; the URL is checked again right before sending (`./ssrf.ts`);
 *   - `redirect: 'manual'` (a redirect is never followed), a 10 s timeout, the first 1 KB of the
 *     answer kept;
 *   - every attempt is a row in webhook_deliveries (the builder's delivery log and Resend).
 *
 * `deliverWebhook` never throws for a delivery failure: it records it and returns `ok: false`
 * with `retryable` (network error, timeout, 408/425/429/5xx), so the background job can decide
 * to try again. Configuration problems throw `WebhookError` (routes answer with its status).
 */

export const WEBHOOK_TIMEOUT_MS = 10_000
/** Kept per form in the delivery log; older rows go in the hourly maintenance job. */
export const KEEP_DELIVERIES_PER_FORM = 100
const MAX_BODY_CAPTURE = 1024
const USER_AGENT = 'IntelForm-Webhooks/1'

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

/** Checks a URL the way a send will (for the form settings PATCH). Throws `WebhookUrlError`. */
export function assertWebhookUrl(raw: string): URL {
  return assertSafeUrl(raw, urlPolicy())
}

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

/** Returns the form's signing secret, creating one on first use. Null when the form is gone. */
export async function ensureWebhookSecret(db: PrismaClient, formId: string, known?: string | null): Promise<string | null> {
  if (known) return known
  const row = await db.form.findUnique({ where: { id: formId }, select: { webhookSecret: true } })
  if (!row) return null
  if (row.webhookSecret) return row.webhookSecret
  // Only set it when still empty, so two first sends at once agree on one secret.
  const secret = generateWebhookSecret()
  await db.form.updateMany({ where: { id: formId, webhookSecret: null }, data: { webhookSecret: secret } })
  const again = await db.form.findUnique({ where: { id: formId }, select: { webhookSecret: true } })
  return again?.webhookSecret ?? null
}

/** Replaces the form's secret and returns the new one (shown to the editor once). Null when the form is gone. */
export async function rotateWebhookSecret(db: PrismaClient, formId: string): Promise<string | null> {
  const secret = generateWebhookSecret()
  const { count } = await db.form.updateMany({ where: { id: formId }, data: { webhookSecret: secret } })
  return count ? secret : null
}

// ---------------------------------------------------------------------------
// Delivery
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
  test?: boolean
  /** The response this payload is for; also builds the stable `webhook-id`. */
  responseId?: string | null
  /** Reuse an id (a retry or Resend keeps the original so receivers can dedupe). */
  webhookId?: string
  /** Override the form's configured URL (Resend of an old delivery when the URL was removed). */
  url?: string
  /** Tests: the fetch to use. */
  fetchImpl?: typeof fetch
}

/** HTTP statuses worth another try. */
export function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/** Network and timeout errors in words for the delivery log (never a stack). */
export function describeError(err: unknown): string {
  if (err instanceof WebhookUrlError) return err.message
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } } | null
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `Timed out after ${WEBHOOK_TIMEOUT_MS / 1000} seconds`
  const code = e?.cause?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The host name could not be found'
  if (code === 'ECONNREFUSED') return 'The connection was refused'
  if (code === 'ECONNRESET') return 'The connection was closed by the endpoint'
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
      if (done) break
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
  return new TextDecoder('utf-8', { fatal: false }).decode(all).replace(/\0/g, '')
}

function newWebhookId(opts: DeliverOptions): string {
  if (opts.webhookId) return opts.webhookId
  return opts.test || !opts.responseId ? `msg_test_${crypto.randomUUID()}` : `msg_${opts.responseId}`
}

/**
 * Sends one signed POST with the form's current URL, headers and secret, and logs it in
 * webhook_deliveries. Throws `WebhookError` when the form is gone, has no URL, or (for a real
 * delivery) has its webhook turned off.
 */
export async function deliverWebhook(db: PrismaClient, formId: string, payload: unknown, opts: DeliverOptions = {}): Promise<DeliveryResult> {
  const form = await db.form.findUnique({ where: { id: formId }, select: { settings: true, webhookSecret: true } })
  if (!form) throw new WebhookError(404, 'not_found', 'That form no longer exists')
  const cfg = readWebhookConfig(form.settings)
  const url = opts.url ?? cfg.url
  if (!url) throw new WebhookError(422, 'webhook_not_configured', 'Add a webhook URL first')
  if (!opts.test && !opts.url && !cfg.enabled) throw new WebhookError(422, 'webhook_disabled', 'The webhook is turned off for this form')

  const secret = await ensureWebhookSecret(db, formId, form.webhookSecret)
  if (!secret) throw new WebhookError(404, 'not_found', 'That form no longer exists')
  const webhookId = newWebhookId(opts)
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const doFetch = opts.fetchImpl ?? fetch

  const started = Date.now()
  let statusCode: number | null = null
  let captured: string | null = null
  let error: string | null = null
  let retryable = false
  try {
    assertSafeUrl(url, urlPolicy())
    const res = await doFetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...Object.fromEntries(cfg.headers),
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'webhook-id': webhookId,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': await signWebhook(secret, webhookId, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    statusCode = res.status
    captured = await readCapped(res)
    if (statusCode >= 300 && statusCode < 400) error = 'Redirects are not followed. Use the final URL.'
    else if (statusCode < 200 || statusCode >= 300) {
      error = `The endpoint answered ${statusCode}`
      retryable = retryableStatus(statusCode)
    }
  } catch (err) {
    error = describeError(err)
    retryable = !(err instanceof WebhookUrlError)
  }
  const durationMs = Date.now() - started
  const ok = error === null

  const deliveryId = await logDelivery(db, {
    formId,
    responseId: opts.responseId ?? null,
    url,
    statusCode,
    durationMs,
    responseBody: captured,
    isTest: !!opts.test,
    webhookId,
    error,
    payload,
  })
  return { deliveryId, webhookId, ok, retryable: ok ? false : retryable, statusCode, durationMs, error }
}

interface DeliveryRow {
  formId: string
  responseId: string | null
  url: string
  statusCode: number | null
  durationMs: number
  responseBody: string | null
  isTest: boolean
  webhookId: string
  error: string | null
  payload: unknown
}

/**
 * One log row. The row goes with its response (ON DELETE CASCADE). If the response went away
 * while this was in flight, the attempt is logged without the link or the answers, so they
 * don't outlive the response. Test sends carry sample answers only.
 */
async function logDelivery(db: PrismaClient, d: DeliveryRow): Promise<string> {
  const payload = JSON.stringify(d.payload ?? null)
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH r AS (SELECT (SELECT id FROM responses WHERE id = ${d.responseId}::uuid) AS id)
    INSERT INTO webhook_deliveries (form_id, response_id, url, status_code, duration_ms, response_body, is_test, webhook_id, error, payload)
    SELECT ${d.formId}::uuid, r.id, ${d.url.slice(0, 2000)}, ${d.statusCode}::int, ${d.durationMs}::int,
      ${d.responseBody === null ? null : d.responseBody.slice(0, 1024)}, ${d.isTest}, ${d.webhookId}, ${d.error === null ? null : d.error.slice(0, 500)},
      CASE WHEN ${d.isTest} OR r.id IS NOT NULL THEN ${payload}::jsonb END
    FROM r
    RETURNING id::text AS id
  `
  return rows[0].id
}

/**
 * Sends a logged delivery again: same payload and webhook-id, fresh timestamp and signature.
 * A real delivery whose response was deleted is refused: its answers must not go out again.
 * Scope the delivery to the form in the route first (`formId` here must match the row's).
 */
export async function resendDelivery(db: PrismaClient, formId: string, deliveryId: string, fetchImpl?: typeof fetch): Promise<DeliveryResult> {
  const d = await db.webhookDelivery.findFirst({
    where: { id: deliveryId, formId },
    select: { formId: true, responseId: true, payload: true, webhookId: true, isTest: true, url: true },
  })
  if (!d || d.payload === null) throw new WebhookError(404, 'not_found', 'That delivery is no longer in the log')
  if (!d.isTest) {
    const response = d.responseId ? await db.response.findUnique({ where: { id: d.responseId }, select: { id: true } }) : null
    if (!response) throw new WebhookError(410, 'response_deleted', 'That response was deleted, so its webhook can’t be resent')
  }
  const form = await db.form.findUnique({ where: { id: d.formId }, select: { settings: true } })
  const current = form ? readWebhookConfig(form.settings).url : null
  return deliverWebhook(db, d.formId, d.payload, {
    test: d.isTest,
    responseId: d.responseId,
    webhookId: d.webhookId ?? undefined,
    url: current ? undefined : d.url,
    fetchImpl,
  })
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
