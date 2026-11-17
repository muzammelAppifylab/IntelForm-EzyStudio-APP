/**
 * The builder's delivery log, the pure part: what state a webhook_deliveries row is in.
 *
 * Signing, the config, the URL rule, the sample payload and the send itself are shared with real
 * deliveries and live in ../webhooks (one implementation of each).
 */

/**
 * A queued "Send test" / "Resend" whose job hasn't finished after this long never will (its job
 * was lost or gave up): the log shows it as failed, and a late job doesn't send it any more.
 */
export const QUEUED_EXPIRES_MS = 15 * 60_000;
export const NEVER_FINISHED = 'This delivery never finished. Resend it.';

/**
 * A delivery's outcome from its stored columns: still queued, delivered with a 2xx, or failed
 * (with the error to show). A row still queued after QUEUED_EXPIRES_MS is failed.
 */
export function deliveryState(
  row: {statusCode: number | null; durationMs: number | null; error: string | null; createdAt: Date},
  now = Date.now()
): {pending: boolean; ok: boolean; error: string | null} {
  const queued = row.durationMs === null && row.error === null;
  if (queued && now - row.createdAt.getTime() > QUEUED_EXPIRES_MS) return {pending: false, ok: false, error: NEVER_FINISHED};
  const ok = !queued && row.error === null && row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300;
  return {pending: queued, ok, error: row.error};
}
