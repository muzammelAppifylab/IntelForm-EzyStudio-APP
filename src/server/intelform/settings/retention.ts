/**
 * Data retention (Settings → Data): responses older than `retentionDays` are deleted. Off by
 * default (null = keep forever). Run once a day by the `intelform-retention` background job
 * (src/server/background.ts + background.json), not on a request.
 *
 * The batches themselves are `applyRetention` in src/server/background.ts (one statement per
 * batch that also keeps forms.response_count in step).
 */

/** The moment before which responses go, or null when retention is off. */
export function retentionCutoff(retentionDays: number | null | undefined, now = new Date()): Date | null {
  if (!retentionDays || !Number.isInteger(retentionDays) || retentionDays < 1) return null;
  return new Date(now.getTime() - retentionDays * 86_400_000);
}
