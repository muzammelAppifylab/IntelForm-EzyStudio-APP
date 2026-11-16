import type {Prisma} from '../../../generated/prisma/client';
import {DontRetry, JobRejected, sendJob, type JobInfo} from '../../../platform/background';
import {config} from '../../../platform/config';
import {getDb} from '../../../platform/db';
import {BuilderError, formGone} from './errors';
import {
  assertSafeUrl,
  describeFetchError,
  generateWebhookSecret,
  MAX_BODY_CAPTURE,
  readWebhookConfig,
  signWebhook,
  UnsafeWebhookUrl,
  WEBHOOK_TIMEOUT_MS,
} from './webhook-core';

/**
 * Outbound webhook deliveries: a `webhook_deliveries` row is written first ("queued": no
 * status, no duration, no error), then ONE background job (list `intelform-webhooks`, data
 * `{deliveryId}`) sends it and records the outcome on that row. One attempt per delivery (PRD:
 * no automatic retries; the person uses Resend), and a job that runs twice finds the row already
 * done and stops. A response deleted before its job runs takes its delivery row with it
 * (ON DELETE CASCADE), so its answers never go out.
 *
 * Real deliveries for new responses: the submit route calls `queueWebhookDelivery()` after its
 * transaction commits. "Send test" and "Resend" are the builder's (src/server/routes/builder.ts).
 */

export const WEBHOOK_LIST = 'intelform-webhooks';
/** Log rows kept per form (the newest). */
export const KEEP_PER_FORM = 100;

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

/** Plain http only off production (a local receiver on a developer's machine). */
export const allowHttpWebhooks = () => !config.production;

/** Replaces the form's secret and returns the new one (shown to the person once). */
export async function rotateWebhookSecret(db: Db, formId: string): Promise<string> {
  const secret = generateWebhookSecret();
  const n = await db.$executeRaw`UPDATE forms SET webhook_secret = ${secret} WHERE id = ${formId}::uuid`;
  if (!n) throw formGone();
  return secret;
}

/** The form's secret, created on first use (one statement, so two first uses agree). */
export async function ensureWebhookSecret(db: Db, formId: string): Promise<string | null> {
  const [row] = await db.$queryRaw<{secret: string}[]>`
    UPDATE forms SET webhook_secret = COALESCE(webhook_secret, ${generateWebhookSecret()})
    WHERE id = ${formId}::uuid
    RETURNING webhook_secret AS secret`;
  return row?.secret ?? null;
}

export interface QueueInput {
  formId: string;
  /** The response this payload is for; null for a test. */
  responseId: string | null;
  payload: unknown;
  isTest: boolean;
  /** Reuse an id (Resend keeps the original so receivers can dedupe). */
  webhookId?: string | null;
  /** The URL the delivery goes to (the form's current one, or the old one on a Resend). */
  url: string;
}

export interface QueuedDelivery {
  deliveryId: string;
  webhookId: string;
}

/** Writes the queued log row and trims the form's log to the newest 100. */
export async function insertDelivery(db: Db, input: QueueInput): Promise<QueuedDelivery> {
  const webhookId =
    input.webhookId ?? (input.isTest || !input.responseId ? `msg_test_${crypto.randomUUID()}` : `msg_${input.responseId}`);
  const [row] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO webhook_deliveries (form_id, response_id, webhook_id, url, payload, is_test)
    VALUES (${input.formId}::uuid, ${input.responseId}::uuid, ${webhookId}, ${input.url.slice(0, 2000)},
      ${JSON.stringify(input.payload ?? null)}::jsonb, ${input.isTest})
    RETURNING id::text AS id`;
  await db.$executeRaw`
    DELETE FROM webhook_deliveries WHERE id IN (
      SELECT id FROM webhook_deliveries WHERE form_id = ${input.formId}::uuid
      ORDER BY created_at DESC, id DESC OFFSET ${KEEP_PER_FORM}
    )`;
  return {deliveryId: row!.id, webhookId};
}

/**
 * Sends the job for a queued delivery (after the row is committed). A refused send is recorded
 * on the row, so the log never shows a delivery that will never run, and rethrown as a 503.
 */
export async function enqueueDelivery(db: Db, requestUrl: string, deliveryId: string, label: string): Promise<{local: boolean}> {
  try {
    const sent = await sendJob(requestUrl, WEBHOOK_LIST, {deliveryId}, {key: `webhook-${deliveryId}`, label: label.slice(0, 120)});
    return {local: sent.local};
  } catch (err) {
    if (!(err instanceof JobRejected)) throw err;
    await db.$executeRaw`
      UPDATE webhook_deliveries SET error = ${'The delivery couldn’t be queued. Try again in a minute.'}, duration_ms = 0
      WHERE id = ${deliveryId}::uuid AND duration_ms IS NULL AND error IS NULL`;
    throw new BuilderError(503, 'jobs_unavailable', 'The webhook couldn’t be queued right now. Try again in a minute.');
  }
}

/**
 * For the submit route: queues the delivery of a new response when the form's webhook is on.
 * Call it AFTER the response's transaction commits. Never throws for a refused job (the row says
 * why); returns null when the webhook is off.
 */
export async function queueWebhookDelivery(
  db: Db,
  requestUrl: string,
  input: {formId: string; formTitle: string; responseId: string; settings: unknown; payload: unknown}
): Promise<QueuedDelivery | null> {
  const cfg = readWebhookConfig(input.settings);
  if (!cfg.enabled || !cfg.url) return null;
  const queued = await insertDelivery(db, {
    formId: input.formId,
    responseId: input.responseId,
    payload: input.payload,
    isTest: false,
    url: cfg.url,
  });
  await enqueueDelivery(db, requestUrl, queued.deliveryId, `Webhook · ${input.formTitle}`).catch(() => undefined);
  return queued;
}

interface DeliveryRow {
  id: string;
  form_id: string;
  response_id: string | null;
  webhook_id: string | null;
  url: string;
  payload: unknown;
  is_test: boolean;
  done: boolean;
  settings: unknown;
}

/** Reads at most `max` bytes of a body, then lets go of the rest. */
async function readCapped(res: Response, max = MAX_BODY_CAPTURE): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const {done, value} = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
  } catch {
    // a truncated body is fine: only the start is kept
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, all.length - at);
    all.set(part, at);
    at += part.length;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all).replace(/\u0000/g, '');
}

export interface DeliveryOutcome {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
}

/**
 * Sends one signed POST and records it. Safe to repeat: a delivery that already has an
 * outcome is left alone. Never throws for the endpoint's failures (they are recorded).
 */
export async function runDelivery(
  db: Db,
  deliveryId: string,
  opts: {fetch?: typeof fetch; allowHttp?: boolean} = {}
): Promise<DeliveryOutcome | null> {
  const [d] = await db.$queryRaw<DeliveryRow[]>`
    SELECT d.id::text AS id, d.form_id::text AS form_id, d.response_id::text AS response_id, d.webhook_id, d.url,
      d.payload, d.is_test, (d.duration_ms IS NOT NULL OR d.error IS NOT NULL) AS done, f.settings
    FROM webhook_deliveries d JOIN forms f ON f.id = d.form_id
    WHERE d.id = ${deliveryId}::uuid`;
  // Gone with its form or response, or already sent: nothing to do.
  if (!d || d.done) return null;

  const cfg = readWebhookConfig(d.settings);
  const url = cfg.url ?? d.url;
  const started = Date.now();
  let statusCode: number | null = null;
  let body: string | null = null;
  let error: string | null = null;

  if (!d.is_test && cfg.url && !cfg.enabled) error = 'The webhook is turned off for this form';
  else if (d.payload === null) error = 'Nothing to send: the delivery has no payload';

  if (error === null) {
    try {
      assertSafeUrl(url, {allowHttp: opts.allowHttp ?? allowHttpWebhooks()});
      const secret = await ensureWebhookSecret(db, d.form_id);
      if (!secret) return null; // the form was deleted meanwhile
      const webhookId = d.webhook_id ?? `msg_test_${crypto.randomUUID()}`;
      const text = JSON.stringify(d.payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const res = await (opts.fetch ?? fetch)(url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          ...Object.fromEntries(cfg.headers),
          'content-type': 'application/json',
          'user-agent': 'IntelForm-Webhooks/1',
          'webhook-id': webhookId,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': await signWebhook(secret, webhookId, timestamp, text),
        },
        body: text,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      statusCode = res.status;
      body = await readCapped(res);
      if (statusCode >= 300 && statusCode < 400) error = 'Redirects are not followed. Use the final URL.';
      else if (statusCode < 200 || statusCode >= 300) error = `The endpoint answered ${statusCode}`;
    } catch (err) {
      error = err instanceof UnsafeWebhookUrl ? err.message : describeFetchError(err);
    }
  }
  const durationMs = Math.max(0, Date.now() - started);
  await db.$executeRaw`
    UPDATE webhook_deliveries
    SET url = ${url.slice(0, 2000)}, status_code = ${statusCode}, duration_ms = ${durationMs},
      response_body = ${body === null ? null : body.slice(0, 1024)}, error = ${error === null ? null : error.slice(0, 500)}
    WHERE id = ${deliveryId}::uuid AND duration_ms IS NULL AND error IS NULL`;
  return {ok: error === null, statusCode, durationMs, error};
}

/** The `intelform-webhooks` handler for src/server/background.ts. */
export async function webhookDeliveryJob(data: unknown, _job?: JobInfo): Promise<void> {
  const deliveryId = (data as {deliveryId?: unknown} | null)?.deliveryId;
  if (typeof deliveryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new DontRetry('The job has no delivery id.');
  const db = getDb();
  if (!db) throw new Error('The Site Database is off.');
  await runDelivery(db, deliveryId);
}
