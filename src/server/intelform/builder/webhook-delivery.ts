import type {Prisma} from '../../../generated/prisma/client';
import {DontRetry, JobRejected, sendJob, type JobInfo} from '../../../platform/background';
import {getDb} from '../../../platform/db';
import {
  ensureWebhookSecret,
  KEEP_DELIVERIES_PER_FORM,
  newWebhookId,
  postSigned,
  readWebhookConfig,
  WEBHOOK_OFF,
  type PostOutcome,
  type UrlPolicy,
} from '../webhooks';
import {BuilderError} from './errors';
import {NEVER_FINISHED, QUEUED_EXPIRES_MS} from './webhook-core';

/**
 * The builder's "Send test" and "Resend": a `webhook_deliveries` row is written first ("queued":
 * no status, no duration, no error), then ONE background job (list `intelform-webhooks`, data
 * `{deliveryId}`) sends it and records the outcome on that row.
 *
 * Test and Resend are one attempt each: a failure is recorded and never sent again on its own
 * (the person can Resend). The list's retries in background.json only cover a job that couldn't
 * reach the database; a job that runs twice finds the row already done and stops. Real responses
 * are a different path with automatic retries: the notify job's first attempt, then
 * `intelform-webhook-deliver` (../notify, ../webhooks/deliver.ts), retried up to 4 times.
 *
 * A real (non-test) delivery is only ever sent while the form's webhook is on, and always to the
 * form's CURRENT URL, never the one in the log: removing the webhook stops every queued or resent
 * delivery. A response deleted before its job runs takes its delivery row with it (ON DELETE
 * CASCADE), so its answers never go out.
 */

export const WEBHOOK_LIST = 'intelform-webhooks';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

export interface QueueInput {
  formId: string;
  /** The response this payload is for; null for a test. */
  responseId: string | null;
  payload: unknown;
  isTest: boolean;
  /** Reuse an id (Resend keeps the original so receivers can dedupe). */
  webhookId?: string | null;
  /** The form's current webhook URL, for the log (the job sends to the URL current when it runs). */
  url: string;
}

export interface QueuedDelivery {
  deliveryId: string;
  webhookId: string;
}

/** Writes the queued log row and trims the form's log to the newest 100. */
export async function insertDelivery(db: Db, input: QueueInput): Promise<QueuedDelivery> {
  const webhookId = input.webhookId ?? newWebhookId(input.isTest ? null : input.responseId);
  const [row] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO webhook_deliveries (form_id, response_id, webhook_id, url, payload, is_test)
    VALUES (${input.formId}::uuid, ${input.responseId}::uuid, ${webhookId}, ${input.url.slice(0, 2000)},
      ${JSON.stringify(input.payload ?? null)}::jsonb, ${input.isTest})
    RETURNING id::text AS id`;
  await db.$executeRaw`
    DELETE FROM webhook_deliveries WHERE id IN (
      SELECT id FROM webhook_deliveries WHERE form_id = ${input.formId}::uuid
      ORDER BY created_at DESC, id DESC OFFSET ${KEEP_DELIVERIES_PER_FORM}
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

interface DeliveryRow {
  id: string;
  form_id: string;
  response_id: string | null;
  webhook_id: string | null;
  payload: unknown;
  is_test: boolean;
  done: boolean;
  /** Queued longer than QUEUED_EXPIRES_MS. */
  expired: boolean;
  settings: unknown;
}

export interface DeliveryOutcome {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
}

/**
 * Sends one queued delivery and records it. Safe to repeat: a delivery that already has an
 * outcome is left alone. Never throws for the endpoint's failures (they are recorded). Nothing is
 * sent, and the reason is recorded, when the row waited too long (QUEUED_EXPIRES_MS), when the
 * form's webhook has no URL any more, or when a real delivery's webhook is turned off.
 */
export async function runDelivery(
  db: Db,
  deliveryId: string,
  opts: {fetch?: typeof fetch; policy?: Partial<UrlPolicy>} = {}
): Promise<DeliveryOutcome | null> {
  const [d] = await db.$queryRaw<DeliveryRow[]>`
    SELECT d.id::text AS id, d.form_id::text AS form_id, d.response_id::text AS response_id, d.webhook_id,
      d.payload, d.is_test, (d.duration_ms IS NOT NULL OR d.error IS NOT NULL) AS done,
      (d.created_at < now() - make_interval(secs => ${QUEUED_EXPIRES_MS / 1000})) AS expired, f.settings
    FROM webhook_deliveries d JOIN forms f ON f.id = d.form_id
    WHERE d.id = ${deliveryId}::uuid`;
  // Gone with its form or response, or already sent: nothing to do.
  if (!d || d.done) return null;

  const cfg = readWebhookConfig(d.settings);
  let out: PostOutcome;
  let sentTo: string | null = null;
  // Only ever to the form's current URL (never the logged one); a real delivery also needs it on.
  const refused = d.expired
    ? NEVER_FINISHED
    : !cfg.url || (!d.is_test && !cfg.enabled)
      ? WEBHOOK_OFF
      : d.payload === null
        ? 'Nothing to send: the delivery has no payload'
        : null;
  if (refused !== null || !cfg.url) {
    out = {ok: false, retryable: false, statusCode: null, durationMs: 0, responseBody: null, error: refused ?? WEBHOOK_OFF};
  } else {
    // After the checks above, so a form whose webhook was removed never gets a new secret here.
    const secret = await ensureWebhookSecret(db, d.form_id);
    if (!secret) return null; // the form was deleted meanwhile
    sentTo = cfg.url;
    out = await postSigned(
      {
        url: cfg.url,
        headers: cfg.headers,
        secret,
        webhookId: d.webhook_id ?? newWebhookId(d.is_test ? null : d.response_id),
        payload: d.payload,
      },
      {fetchImpl: opts.fetch, policy: opts.policy}
    );
  }
  await db.$executeRaw`
    UPDATE webhook_deliveries
    SET url = COALESCE(${sentTo === null ? null : sentTo.slice(0, 2000)}, url), status_code = ${out.statusCode}::int,
      duration_ms = ${out.durationMs}::int, response_body = ${out.responseBody === null ? null : out.responseBody.slice(0, 1024)},
      error = ${out.error === null ? null : out.error.slice(0, 500)}
    WHERE id = ${deliveryId}::uuid AND duration_ms IS NULL AND error IS NULL`;
  return {ok: out.ok, statusCode: out.statusCode, durationMs: out.durationMs, error: out.error};
}

/** The `intelform-webhooks` handler for src/server/background.ts. */
export async function webhookDeliveryJob(data: unknown, _job?: JobInfo): Promise<void> {
  const deliveryId = (data as {deliveryId?: unknown} | null)?.deliveryId;
  if (typeof deliveryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new DontRetry('The job has no delivery id.');
  const db = getDb();
  if (!db) throw new Error('The Site Database is off.');
  await runDelivery(db, deliveryId);
}
