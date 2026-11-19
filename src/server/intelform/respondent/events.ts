import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {formEventInput} from '../../../lib/intelform/api-public';
import {exactResponsesSql} from '../forms/counts';
import {notFound, RespondentError} from './errors';
import {SLUG_RE} from './load';
import {retryAfter, tooMany} from './rate-limit';

/**
 * Funnel events (view, start) from the respondent page. One per type per session token: the
 * insert dedupes with ON CONFLICT DO NOTHING (form_id, type, session_token is unique), so a session
 * counts at most one view and one start per form, which is the per-session limit. The 15-minute
 * rollup (form_event_counts) and, for a start, the form's all-time starts (form_counts) are bumped
 * in the same statement only for rows actually inserted, each in ONE random shard of 16
 * (src/server/intelform/forms/counts.ts) so a burst never queues on one row; forms.starts_total
 * is a copy refreshed by syncFormCounts for the forms marked dirty. ONE statement per beacon:
 * the IP's window, the form by slug, whether it is open (live, close date, response cap against
 * the exact count), then the event, its rollup, the start count and the dirty markers (`e` for
 * the Summary, `c` for a start; ON CONFLICT DO NOTHING, so no write when the minute's marker is
 * there). Completions are the responses themselves (form_counts via the responses triggers, and
 * responses.submitted_at), so they need no event.
 *
 * One rate-limit window per IP per minute, across forms (the per IP and form window was a second
 * row written on every beacon and is gone): a generous ceiling, not a cap on real traffic. A
 * school or office behind one shared address sends a view and a start per person, and counting
 * fewer would undercount the funnel. It only stops one machine flooding the tables.
 */
/** Events per IP per minute across all forms (a page sends a view and a start per form). */
export const EVENTS_IP_RATE_LIMIT = 1200;

/** Parses the body: JSON text (a keepalive fetch or sendBeacon), `{type, session}`. */
export function parseEvent(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RespondentError(400, 'invalid_json', 'The request body must be JSON.');
  }
  const parsed = formEventInput.safeParse(raw);
  if (!parsed.success) throw new RespondentError(400, 'invalid_request', 'Unknown event.');
  return parsed.data;
}

/** Whether the form takes responses now: live, before its close date, under its cap (exact count). */
const openSql = Prisma.sql`(f.status = 'live'
  AND (intelform_try_timestamptz(f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') > now())
  AND NOT coalesce(jsonb_typeof(f.settings->'responseCap') = 'number'
    AND ${exactResponsesSql(Prisma.sql`f.id`)} >= (f.settings->>'responseCap')::numeric, false))`;

export async function handleEvent(db: Pick<PrismaClient, '$queryRaw'>, slug: string, bodyText: string, ipKey: string): Promise<void> {
  const {type, session} = parseEvent(bodyText);
  const clean = slug.toLowerCase();
  if (!SLUG_RE.test(clean)) throw notFound();
  // ONE statement: the per IP window (never a key per attacker-chosen slug); the form (drafts,
  // unknown and old slugs: 404) only under it; then, on an open form, the event, its 15-minute
  // rollup and, for a start, the form's all-time starts, both in one random shard, and the markers.
  const rows = await db.$queryRaw<{ip_count: number; found: boolean}[]>`
    WITH ipl AS (
      INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
      VALUES (${`events:ip:${ipKey}`}, date_bin(make_interval(secs => 60), now(), 'epoch'), 60, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
      RETURNING count
    ),
    f AS (
      SELECT f.id, ${openSql} AS open
      FROM forms f
      WHERE f.slug = ${clean} AND f.published_version_id IS NOT NULL AND f.status <> 'draft'
        AND (SELECT count FROM ipl) <= ${EVENTS_IP_RATE_LIMIT}::int
    ),
    ins AS (
      INSERT INTO form_events (form_id, type, session_token)
      SELECT f.id, ${type}, ${session}
      FROM f WHERE f.open
      ON CONFLICT DO NOTHING
      RETURNING form_id, type, created_at
    ),
    s AS (SELECT floor(random() * 16)::smallint AS shard),
    counted AS (
      INSERT INTO form_event_counts AS ec (form_id, bucket, shard, views, starts)
      SELECT ins.form_id, date_bin('15 minutes', ins.created_at, '2000-01-01'::timestamptz), s.shard,
        (ins.type = 'view')::int, (ins.type = 'start')::int
      FROM ins, s
      ON CONFLICT (form_id, bucket, shard) DO UPDATE SET
        views = ec.views + EXCLUDED.views,
        starts = ec.starts + EXCLUDED.starts
      RETURNING 1
    ),
    started AS (
      INSERT INTO form_counts AS fc (form_id, shard, starts)
      SELECT ins.form_id, s.shard, 1 FROM ins, s WHERE ins.type = 'start'
      ON CONFLICT (form_id, shard) DO UPDATE SET starts = fc.starts + 1
      RETURNING 1
    ),
    marked AS (
      INSERT INTO intelform_dirty_forms (kind, bucket, form_id)
      SELECT k.kind, date_trunc('minute', now()), ins.form_id
      FROM ins CROSS JOIN LATERAL (SELECT 'e' AS kind UNION ALL SELECT 'c' WHERE ins.type = 'start') k
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count FROM ipl)::int AS ip_count, EXISTS (SELECT 1 FROM f) AS found,
      (SELECT count(*) FROM counted) + (SELECT count(*) FROM started) + (SELECT count(*) FROM marked) AS written
  `;
  const row = rows[0];
  if (Number(row?.ip_count ?? 0) > EVENTS_IP_RATE_LIMIT) throw tooMany(retryAfter(60));
  if (!row?.found) throw notFound();
}
