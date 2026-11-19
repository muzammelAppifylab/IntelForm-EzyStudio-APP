/**
 * Data retention (Settings → Data): responses older than `retentionDays` are deleted. Off by
 * default (null = keep forever). Run every hour (at :30) by the `intelform-retention` background
 * job (src/server/background.ts + background.json), then a minute at a time while more are past
 * the period, never on a request.
 *
 * The batches themselves are `applyRetention` in src/server/background.ts (one DELETE per
 * batch; the responses delete trigger takes the rows off form_counts and form_response_hours, and
 * the every-minute syncFormCounts refreshes the copy on forms, last_response_at included).
 */

/** The moment before which responses go, or null when retention is off. */
export function retentionCutoff(retentionDays: number | null | undefined, now = new Date()): Date | null {
  if (!retentionDays || !Number.isInteger(retentionDays) || retentionDays < 1) return null;
  return new Date(now.getTime() - retentionDays * 86_400_000);
}
