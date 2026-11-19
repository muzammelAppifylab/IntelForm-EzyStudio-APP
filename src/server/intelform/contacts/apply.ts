import type {PrismaClient} from '../../../platform/db';

/**
 * The contacts rollup, off the submit (migration 20261120200000): the responses insert trigger
 * queues one row per response with a contact in `intelform_contact_queue`, and
 * `intelform_contacts_apply` (SQL) folds a batch of them into `contacts` in key order. Run by the
 * notify job a submit wakes, by the 15-minute run, and before the contacts screens read (one
 * batch), so the list and a contact's page show every response. A delete, an answer update or a
 * rebuild of a contact applies or drops its own queued rows first (triggers), so nothing is
 * counted twice or subtracted before it was added.
 */

/** Queued rows folded per statement (one aggregate upsert, contacts locked in key order). */
export const CONTACT_APPLY_BATCH = 1000;

export interface ApplyResult {
  rows: number;
  /** A full batch came back: more may be queued. */
  more: boolean;
}

/** One statement: up to `batch` queued rows. A WITH query, so it is never sent twice. */
export async function applyContactBatch(db: Pick<PrismaClient, '$queryRaw'>, batch = CONTACT_APPLY_BATCH): Promise<number> {
  const [row] = await db.$queryRaw<{n: number}[]>`
    WITH applied AS (SELECT intelform_contacts_apply(NULL::text[], ${batch}::int) AS n)
    SELECT n FROM applied
  `;
  return Number(row?.n ?? 0);
}

/** Batches until the queue is empty or `budgetMs` is spent. */
export async function applyContactQueue(
  db: Pick<PrismaClient, '$queryRaw'>,
  opts: {budgetMs: number; batch?: number; now?: () => number}
): Promise<ApplyResult> {
  const now = opts.now ?? Date.now;
  const until = now() + opts.budgetMs;
  const batch = opts.batch ?? CONTACT_APPLY_BATCH;
  const out: ApplyResult = {rows: 0, more: false};
  for (;;) {
    const n = await applyContactBatch(db, batch);
    out.rows += n;
    if (n < batch) return out;
    if (now() >= until) {
      out.more = true;
      return out;
    }
  }
}
