import type {PrismaClient} from '../../../generated/prisma/client';
import {BLOCK_STEPS_SECONDS} from '../../../lib/intelform/spam';

/**
 * The site's block list (`intelform_blocked_ips`): address blocks the submit gate refuses with
 * one primary-key probe inside its own statement (respondent/submit.ts `gateSql`).
 *
 *   autoBlock   an address block that kept hitting the per-address limits: blocked 1 hour, then
 *               24 hours, then 7 days for each new block within 30 days of the last one
 *   addBlock    an admin blocks an address by hand (App settings → Spam protection)
 *   removeBlock an admin unblocks one (its escalation starts again)
 *   listBlocks  the blocks in force, newest first, keyset paged
 *
 * Rows are kept 30 days after they expire (so a repeat offender escalates), then removed by the
 * next autoBlock (a bounded delete on the expires_at index): no background job needed.
 */

type RawDb = Pick<PrismaClient, '$queryRaw'>;

/** How long after it ends a block is remembered for escalation. */
export const BLOCK_MEMORY_DAYS = 30;

export interface AutoBlockInput {
  ipKey: string;
  /** The address block itself (shown to admins with the settings permission), or null when unknown. */
  ipBlock: string | null;
  formId: string;
  /** Refused submits that led to it. */
  strikes: number;
}

export interface AutoBlockResult {
  /** This call started a new block (false: one was already in force, a parallel refusal). */
  fresh: boolean;
  /** The escalation step: 1, 2, 3+. */
  step: number;
  until: Date;
}

/**
 * Blocks `ipKey` (one statement): a new row for 1 hour; an expired row from an earlier block
 * escalates (24 hours, then 7 days); a block in force stays as it is. Also removes up to 100 rows
 * whose block ended over 30 days ago.
 */
export async function autoBlock(db: RawDb, input: AutoBlockInput): Promise<AutoBlockResult> {
  const [s1, s2, s3] = BLOCK_STEPS_SECONDS;
  const rows = await db.$queryRaw<{blocks: number; expires_at: Date; was_active: boolean}[]>`
    WITH prev AS (
      SELECT expires_at > now() AS active FROM intelform_blocked_ips WHERE ip_key = ${input.ipKey}
    ),
    old AS (
      DELETE FROM intelform_blocked_ips WHERE ctid = ANY(ARRAY(
        SELECT ctid FROM intelform_blocked_ips
        WHERE expires_at < now() - make_interval(days => ${BLOCK_MEMORY_DAYS}::int)
        ORDER BY expires_at LIMIT 100
      ))
    ),
    up AS (
      INSERT INTO intelform_blocked_ips AS b (ip_key, ip_block, reason, hits, blocks, form_id, expires_at, updated_at)
      VALUES (${input.ipKey}, ${input.ipBlock}, 'limits', ${input.strikes}::int, 1, ${input.formId}::uuid,
        now() + make_interval(secs => ${s1}::int), now())
      ON CONFLICT (ip_key) DO UPDATE SET
        blocks = CASE WHEN b.expires_at > now() THEN b.blocks ELSE b.blocks + 1 END,
        expires_at = CASE WHEN b.expires_at > now() THEN b.expires_at
          ELSE now() + make_interval(secs => CASE WHEN b.blocks + 1 <= 1 THEN ${s1}::int WHEN b.blocks + 1 = 2 THEN ${s2}::int ELSE ${s3}::int END) END,
        reason = CASE WHEN b.expires_at > now() THEN b.reason ELSE 'limits' END,
        hits = b.hits + EXCLUDED.hits,
        ip_block = coalesce(EXCLUDED.ip_block, b.ip_block),
        form_id = EXCLUDED.form_id,
        updated_at = now()
      RETURNING b.blocks, b.expires_at
    )
    SELECT up.blocks, up.expires_at, coalesce((SELECT active FROM prev), false) AS was_active FROM up
  `;
  const row = rows[0];
  return {
    fresh: !row?.was_active,
    step: Number(row?.blocks ?? 1),
    until: row?.expires_at ? new Date(row.expires_at) : new Date(Date.now() + s1 * 1000),
  };
}

/** Durations an admin can block for by hand. */
export const MANUAL_BLOCK_SECONDS = {hour: 3600, day: 86_400, week: 7 * 86_400, month: 30 * 86_400} as const;
export type ManualBlockLength = keyof typeof MANUAL_BLOCK_SECONDS;

/** An admin's block: replaces whatever is there (a block in force gets the new length). */
export async function addBlock(db: RawDb, input: {ipKey: string; ipBlock: string; length: ManualBlockLength; userId: number | null}): Promise<void> {
  await db.$queryRaw`
    INSERT INTO intelform_blocked_ips AS b (ip_key, ip_block, reason, hits, blocks, expires_at, created_by, updated_at)
    VALUES (${input.ipKey}, ${input.ipBlock}, 'manual', 0, 1, now() + make_interval(secs => ${MANUAL_BLOCK_SECONDS[input.length]}::int), ${input.userId}, now())
    ON CONFLICT (ip_key) DO UPDATE SET
      ip_block = EXCLUDED.ip_block, reason = 'manual', expires_at = EXCLUDED.expires_at,
      created_by = EXCLUDED.created_by, updated_at = now()
    RETURNING ip_key
  `;
}

/**
 * Unblocks (and forgets) one block, with the address's strikes and its per-form submit counts, so
 * the admin's "let them in" holds: the next submit isn't refused (and re-blocked) at once. False
 * when there was no block in force.
 */
export async function removeBlock(db: RawDb, ipKey: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ip_key: string}[]>`
    WITH gone AS (
      DELETE FROM intelform_blocked_ips WHERE ip_key = ${ipKey} AND expires_at > now() RETURNING ip_key
    ),
    counts AS (
      DELETE FROM intelform_rate_limits
      WHERE EXISTS (SELECT 1 FROM gone)
        AND (key = ${`strike:${ipKey}`} OR key LIKE ${`respond-h:${ipKey}:%`} OR key LIKE ${`respond-d:${ipKey}:%`})
    )
    SELECT ip_key FROM gone
  `;
  return rows.length > 0;
}

export interface BlockRow {
  ip_key: string;
  ip_block: string | null;
  reason: string;
  hits: number;
  blocks: number;
  form_id: string | null;
  form_title: string | null;
  expires_at: Date;
  updated_at: Date;
}

export const BLOCKS_PAGE = 50;

/** Blocks in force, the latest first, `before` = the last row's (updatedAt, ipKey). One query. */
export async function listBlocks(db: RawDb, before: {at: Date; key: string} | null): Promise<BlockRow[]> {
  return db.$queryRaw<BlockRow[]>`
    SELECT b.ip_key, b.ip_block, b.reason, b.hits, b.blocks, b.form_id::text AS form_id, f.title AS form_title,
      b.expires_at, b.updated_at
    FROM intelform_blocked_ips b LEFT JOIN forms f ON f.id = b.form_id
    WHERE b.expires_at > now()
      AND (${before?.at ?? null}::timestamptz IS NULL OR (b.updated_at, b.ip_key) < (${before?.at ?? null}::timestamptz, ${before?.key ?? ''}))
    ORDER BY b.updated_at DESC, b.ip_key DESC
    LIMIT ${BLOCKS_PAGE + 1}
  `;
}
