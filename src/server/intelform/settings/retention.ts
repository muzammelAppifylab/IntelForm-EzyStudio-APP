import type {PrismaClient} from '../../../platform/db';

/**
 * Data retention (Settings → Data): responses older than `retentionDays` are deleted. Off by
 * default (null = keep forever). Run once a day by the `intelform-retention` background job
 * (src/server/background.ts + background.json), not on a request.
 *
 * Each batch is ONE statement: it deletes up to 1,000 expired responses and, in the same
 * statement, takes them off their forms' `response_count` and moves `last_response_at` back to
 * the newest response that stays. The forms rows are locked by the UPDATE, so a submit that
 * lands at the same moment is counted exactly once.
 */

export const RETENTION_BATCH = 1000;
/** A job has 60 s: a run stops after this many batches or 40 s, and the next day's run carries on. */
export const RETENTION_MAX_BATCHES = 100;
const RETENTION_BUDGET_MS = 40_000;

/** The moment before which responses go, or null when retention is off. */
export function retentionCutoff(retentionDays: number | null | undefined, now = new Date()): Date | null {
  if (!retentionDays || !Number.isInteger(retentionDays) || retentionDays < 1) return null;
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

/** Deletes one batch; returns how many responses went. */
export async function deleteExpiredBatch(db: PrismaClient, cutoff: Date, batch = RETENTION_BATCH): Promise<number> {
  const rows = await db.$queryRaw<{deleted: number}[]>`
    WITH gone AS (
      DELETE FROM responses
      WHERE id IN (SELECT id FROM responses WHERE submitted_at < ${cutoff} ORDER BY submitted_at LIMIT ${batch})
      RETURNING form_id
    ),
    touched AS (SELECT form_id, count(*)::int AS n FROM gone GROUP BY form_id),
    counted AS (
      UPDATE forms f
      SET response_count = GREATEST(f.response_count - t.n, 0),
          last_response_at = (
            SELECT max(r.submitted_at) FROM responses r
            WHERE r.form_id = f.id AND r.submitted_at >= ${cutoff}
          )
      FROM touched t
      WHERE f.id = t.form_id
      RETURNING f.id
    )
    SELECT (SELECT count(*)::int FROM gone) AS deleted, (SELECT count(*)::int FROM counted) AS forms`;
  return Number(rows[0]?.deleted ?? 0);
}

/** Applies the retention setting; returns how many responses were deleted. */
export async function applyRetention(db: PrismaClient, now = new Date()): Promise<number> {
  const row = await db.intelformSettings.findUnique({where: {id: 1}, select: {retentionDays: true}});
  const cutoff = retentionCutoff(row?.retentionDays, now);
  if (!cutoff) return 0;
  let total = 0;
  const until = Date.now() + RETENTION_BUDGET_MS;
  for (let i = 0; i < RETENTION_MAX_BATCHES && Date.now() < until; i++) {
    const deleted = await deleteExpiredBatch(db, cutoff);
    total += deleted;
    if (deleted < RETENTION_BATCH) break;
  }
  return total;
}
