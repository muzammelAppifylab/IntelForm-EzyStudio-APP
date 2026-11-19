import {Prisma, type PrismaClient} from '../../../generated/prisma/client';

/**
 * A form's all-time counters live in `form_counts`: 16 shards per form, so a burst of submits
 * (the responses triggers add each insert statement to one random shard) and "start" beacons
 * (the events route, same) never queue on one row. Deletes subtract from shard 0, so a shard may
 * be negative; the SUM over a form's shards is exact.
 *
 * `forms.response_count`, `starts_total` and `last_response_at` are a COPY, refreshed every
 * minute by `syncFormCounts` (the every-minute job). Read the copy where a minute stale is fine
 * (lists, sorts, the dashboard strip); read the exact sum with the helpers below, inside the
 * caller's own query, where a person compares the number right after a change (the responses
 * table and Summary totals, the form header, close / reopen against a response cap).
 */

/** Forms refreshed per run at most; a bigger backlog finishes on the next minutes' runs. */
export const SYNC_BATCH = 1000;

/**
 * Copies the exact counters onto `forms` for every form whose copy differs (IS DISTINCT FROM),
 * so an idle site reads a few hundred small rows and writes nothing. ONE statement, at most
 * SYNC_BATCH forms written.
 *
 * last_response_at is the newest response that still exists (one probe of the responses
 * (form_id, submitted_at DESC) index), not the shards' max: deletes never lower the shards'
 * last_response_at, but a delete changes the count, so the form is picked up and its
 * last_response_at moves back here (the delete paths used to do that themselves). A form whose
 * count is unchanged but got a newer response (deletes and submits that cancel out) is picked up
 * by the shards' max being past the copy. The probe runs only for those forms; a form whose
 * shards' max stays past the copy after a delete is probed each run but written only on change.
 *
 * Shards are never folded: a form has at most 16 rows, and folding would race the triggers.
 * Returns how many forms were updated.
 */
export async function syncFormCounts(db: Pick<PrismaClient, '$executeRaw'>): Promise<number> {
  return db.$executeRaw`
    WITH sums AS (
      SELECT form_id, sum(responses)::int AS responses, sum(starts)::int AS starts, max(last_response_at) AS last_at
      FROM form_counts GROUP BY form_id
    ),
    candidates AS (
      SELECT f.id, f.last_response_at AS old_last,
        GREATEST(s.responses, 0) AS responses, GREATEST(s.starts, 0) AS starts,
        (f.response_count IS DISTINCT FROM GREATEST(s.responses, 0)) AS count_moved,
        (f.starts_total IS DISTINCT FROM GREATEST(s.starts, 0)) AS starts_moved,
        (s.last_at > COALESCE(f.last_response_at, '-infinity'::timestamptz)) AS maybe_newer
      FROM sums s JOIN forms f ON f.id = s.form_id
    ),
    changed AS (
      SELECT c.id, c.responses, c.starts, l.last_at
      FROM candidates c
      CROSS JOIN LATERAL (
        -- The index probe runs only for a form whose responses changed (CASE evaluates lazily).
        SELECT CASE WHEN c.count_moved OR c.maybe_newer
          THEN (SELECT r.submitted_at FROM responses r WHERE r.form_id = c.id ORDER BY r.submitted_at DESC LIMIT 1)
          ELSE c.old_last END AS last_at
      ) l
      WHERE c.count_moved OR c.starts_moved OR l.last_at IS DISTINCT FROM c.old_last
      ORDER BY c.id
      LIMIT ${SYNC_BATCH}
    )
    UPDATE forms f SET
      response_count = c.responses,
      starts_total = c.starts,
      last_response_at = c.last_at
    FROM changed c
    WHERE f.id = c.id
  `;
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
