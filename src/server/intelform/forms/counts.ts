import {Prisma, type PrismaClient} from '../../../generated/prisma/client';

/**
 * A form's all-time counters live in `form_counts`: 16 shards per form, so a burst of submits
 * (the responses triggers add each insert statement to one random shard) and "start" beacons
 * (the events route, same) never queue on one row. Deletes subtract from shard 0, so a shard may
 * be negative; the SUM over a form's shards is exact.
 *
 * `forms.response_count`, `starts_total` and `last_response_at` are a COPY, refreshed by
 * `syncFormCounts` for the forms marked dirty: by the notify job a submit wakes (about a minute
 * after it) and by the 15-minute run (start beacons, deletes). Read the copy where a few minutes stale is fine
 * (lists, sorts, the dashboard strip); read the exact sum with the helpers below, inside the
 * caller's own query, where a person compares the number right after a change (the responses
 * table and Summary totals, the form header, close / reopen against a response cap).
 */

/** Forms refreshed per run at most; a bigger backlog finishes on the next runs. */
export const SYNC_BATCH = 1000;
/**
 * A minute's marker is dropped once the minute ended this long ago (a submit that began in the
 * minute has committed by then), so a submit's change is never lost between a run and its delete.
 */
export const MARKER_SETTLE = "interval '90 seconds'";

/**
 * Copies the exact counters onto `forms` for the forms marked dirty (`intelform_dirty_forms`,
 * kind `c`: the responses insert and delete triggers and the start beacon add one row per form
 * and minute), never for every form: an idle site reads one empty index range and writes
 * nothing. ONE statement: up to SYNC_BATCH marked forms, their copies written only where they
 * differ (IS DISTINCT FROM), and their markers of minutes that ended MARKER_SETTLE ago deleted
 * (a marker of the current minute stays for the next run).
 *
 * last_response_at is the newest response that still exists (one probe of the responses
 * (form_id, submitted_at DESC) index), not the shards' max: deletes never lower the shards'
 * last_response_at, but a delete marks the form, so its last_response_at moves back here.
 * Markers of deleted forms are dropped too. Returns how many forms were updated.
 */
export async function syncFormCounts(db: Pick<PrismaClient, '$queryRaw'>): Promise<number> {
  const rows = await db.$queryRaw<{updated: number}[]>`
    WITH marked AS (
      SELECT DISTINCT form_id FROM intelform_dirty_forms WHERE kind = 'c'
      ORDER BY form_id LIMIT ${SYNC_BATCH}
    ),
    sums AS (
      SELECT m.form_id, GREATEST(coalesce(sum(fc.responses), 0), 0)::int AS responses,
        GREATEST(coalesce(sum(fc.starts), 0), 0)::int AS starts
      FROM marked m LEFT JOIN form_counts fc ON fc.form_id = m.form_id
      GROUP BY m.form_id
    ),
    changed AS (
      SELECT f.id, s.responses, s.starts,
        (SELECT r.submitted_at FROM responses r WHERE r.form_id = f.id ORDER BY r.submitted_at DESC LIMIT 1) AS last_at,
        f.response_count, f.starts_total, f.last_response_at
      FROM sums s JOIN forms f ON f.id = s.form_id
    ),
    upd AS (
      UPDATE forms f SET response_count = c.responses, starts_total = c.starts, last_response_at = c.last_at
      FROM changed c
      WHERE f.id = c.id AND (c.response_count IS DISTINCT FROM c.responses OR c.starts_total IS DISTINCT FROM c.starts
        OR c.last_response_at IS DISTINCT FROM c.last_at)
      RETURNING 1
    ),
    cleared AS (
      DELETE FROM intelform_dirty_forms d USING marked m
      WHERE d.kind = 'c' AND d.form_id = m.form_id AND d.bucket < now() - interval '1 minute' - ${Prisma.raw(MARKER_SETTLE)}
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM upd) AS updated, (SELECT count(*)::int FROM cleared) AS cleared
  `;
  return Number(rows[0]?.updated ?? 0);
}

/**
 * The exact all-time response count of the form whose id is `formId` (a column reference such as
 * Prisma.sql`f.id`, never a value from the request), as a scalar subquery for the caller's own
 * SELECT / RETURNING: at most 16 rows read by the form_counts primary key, no extra round trip.
 */
export function exactResponsesSql(formId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(SELECT GREATEST(COALESCE(sum(fc.responses), 0), 0)::int FROM form_counts fc WHERE fc.form_id = ${formId})`;
}

/**
 * The exact all-time responses and starts, as a LATERAL join for a page of forms in the caller's
 * own query: `FROM paged f ${exactCountsJoin(Prisma.sql`f.id`, Prisma.sql`fc`)}` exposes
 * `fc.responses` and `fc.starts` (one aggregate row per form, so never a query per row).
 */
export function exactCountsJoin(formId: Prisma.Sql, alias: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CROSS JOIN LATERAL (
    SELECT GREATEST(COALESCE(sum(responses), 0), 0)::int AS responses, GREATEST(COALESCE(sum(starts), 0), 0)::int AS starts
    FROM form_counts WHERE form_id = ${formId}
  ) ${alias}`;
}

/** The exact count from the shards Prisma read with a form (`counts: {select: {responses: true}}`). */
export function sumShards(shards: readonly {responses: number}[]): number {
  return Math.max(0, shards.reduce((n, s) => n + s.responses, 0));
}
