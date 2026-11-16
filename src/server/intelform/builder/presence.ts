import type {PresenceEditor, PresenceResponse} from '../../../lib/intelform/api-builder';
import type {Prisma} from '../../../generated/prisma/client';

/**
 * Who has a form open in the builder (PRD: "the second editor sees a banner that someone else
 * is editing"). No websockets: each builder tab POSTs every 20 s while visible and DELETEs on
 * pagehide. Rows live in `form_presence` (one per form and tab), so every Worker instance sees
 * the same people; "live" means seen in the last 45 seconds. Each poll also drops that form's
 * stale rows, so the table stays the size of the open tabs.
 */

export const PRESENCE_TTL_SECONDS = 45;
const MAX_OTHERS = 50;

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

interface PollRow {
  revision: number;
  updated_by: number | null;
  updated_by_name: string | null;
  others: {userId: number; name: string; seenAt: string}[] | null;
}

/**
 * One poll: records this tab (when `touch`: people who can edit; viewers can't, so they never
 * raise the banner for others), sweeps the form's stale rows, and answers who else is here plus
 * the form's save marker. ONE statement. Null when the form doesn't exist.
 */
export async function pollPresence(
  db: Db,
  args: {formId: string; tabId: string; userId: number; touch: boolean}
): Promise<PresenceResponse | null> {
  const {formId, tabId, userId, touch} = args;
  const [row] = await db.$queryRaw<PollRow[]>`
    WITH f AS (
      SELECT f.id, f.revision, f.updated_by, u.name AS updated_by_name
      FROM forms f LEFT JOIN users u ON u.id = f.updated_by
      WHERE f.id = ${formId}::uuid
    ),
    swept AS (
      DELETE FROM form_presence
      -- Never this tab's own row: the upsert below may touch it in the same statement.
      WHERE form_id = ${formId}::uuid AND tab_id <> ${tabId} AND seen_at < now() - make_interval(secs => ${PRESENCE_TTL_SECONDS}::int)
    ),
    touched AS (
      INSERT INTO form_presence (form_id, tab_id, user_id, seen_at)
      SELECT f.id, ${tabId}::varchar, ${userId}::int, now() FROM f WHERE ${touch}::boolean
      ON CONFLICT (form_id, tab_id) DO UPDATE SET seen_at = EXCLUDED.seen_at
        WHERE form_presence.user_id = EXCLUDED.user_id
    )
    SELECT f.revision, f.updated_by, f.updated_by_name,
      (SELECT json_agg(json_build_object('userId', o.user_id, 'name', o.name, 'seenAt', o.seen_at) ORDER BY o.seen_at DESC)
       FROM (
         SELECT p.user_id, u.name, p.seen_at
         FROM form_presence p JOIN users u ON u.id = p.user_id
         WHERE p.form_id = f.id AND p.tab_id <> ${tabId}
           AND p.seen_at > now() - make_interval(secs => ${PRESENCE_TTL_SECONDS}::int)
         ORDER BY p.seen_at DESC
         LIMIT ${MAX_OTHERS}
       ) o) AS others
    FROM f`;
  if (!row) return null;
  return {
    others: othersFrom(row.others ?? [], userId),
    revision: row.revision,
    updatedBy: row.updated_by !== null && row.updated_by_name !== null ? {id: row.updated_by, name: row.updated_by_name} : null,
  };
}

/** Newest first, one entry per person; `self` marks the caller's other tabs. */
export function othersFrom(rows: {userId: number; name: string}[], me: number): PresenceEditor[] {
  const seen = new Set<number>();
  const out: PresenceEditor[] = [];
  for (const r of rows) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push({userId: r.userId, name: r.name, self: r.userId === me});
  }
  return out;
}

/** The tab closed: forget it (only the caller's own tab). */
export async function leavePresence(db: Db, args: {formId: string; tabId: string; userId: number}): Promise<void> {
  await db.$executeRaw`
    DELETE FROM form_presence WHERE form_id = ${args.formId}::uuid AND tab_id = ${args.tabId} AND user_id = ${args.userId}`;
}
