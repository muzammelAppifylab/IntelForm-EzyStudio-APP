import type {PrismaClient} from '../../../generated/prisma/client';
import {formEventInput} from '../../../lib/intelform/api-public';
import {RespondentError} from './errors';
import {isClosed, requireFormMeta} from './load';
import {hit, retryAfter, tooMany} from './rate-limit';

/**
 * Funnel events (view, start) from the respondent page. One per type per session token: the
 * insert dedupes with ON CONFLICT DO NOTHING and the 15-minute rollup (form_event_counts) and
 * forms.starts_total are bumped in the same statement only for rows actually inserted. Two round
 * trips per beacon: the IP limit beside the form read, then everything else in one statement. Completions are the responses
 * themselves (forms.response_count and responses.submitted_at), so they need no event.
 */
export const EVENTS_RATE_LIMIT = 30;
/** Events per IP per minute across all forms (a page sends a view and a start per form). */
export const EVENTS_IP_RATE_LIMIT = 120;

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

export async function handleEvent(db: Pick<PrismaClient, '$queryRaw'>, slug: string, bodyText: string, ipKey: string): Promise<void> {
  const {type, session} = parseEvent(bodyText);
  // Per IP (never a key per attacker-chosen slug) together with the form load: one trip.
  const [ipCount, form] = await Promise.all([hit(db, `events:ip:${ipKey}`, 60), requireFormMeta(db, slug)]);
  if (ipCount > EVENTS_IP_RATE_LIMIT) throw tooMany(retryAfter(60));
  const open = !isClosed(form);
  // Then ONE statement: the per IP and form window, and (under it, on an open form) the event,
  // its 15-minute rollup and, for a start, the form's all-time starts counter.
  const rows = await db.$queryRaw<{count: number}[]>`
    WITH rl AS (
      INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
      VALUES (${`events:${ipKey}:${form.id}`}, date_bin(make_interval(secs => 60), now(), 'epoch'), 60, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
      RETURNING count
    ),
    ins AS (
      INSERT INTO form_events (form_id, type, session_token)
      SELECT ${form.id}::uuid, ${type}, ${session}
      WHERE ${open}::boolean AND (SELECT count FROM rl) <= ${EVENTS_RATE_LIMIT}::int
      ON CONFLICT DO NOTHING
      RETURNING form_id, type, created_at
    ),
    counted AS (
      INSERT INTO form_event_counts (form_id, bucket, views, starts)
      SELECT form_id, date_bin('15 minutes', created_at, '2000-01-01'::timestamptz), (type = 'view')::int, (type = 'start')::int FROM ins
      ON CONFLICT (form_id, bucket) DO UPDATE SET
        views = form_event_counts.views + EXCLUDED.views,
        starts = form_event_counts.starts + EXCLUDED.starts
      RETURNING 1
    ),
    started AS (
      UPDATE forms SET starts_total = starts_total + 1
      WHERE id = ${form.id}::uuid AND EXISTS (SELECT 1 FROM ins WHERE type = 'start')
      RETURNING 1
    )
    SELECT (SELECT count FROM rl)::int AS count, (SELECT count(*) FROM counted) + (SELECT count(*) FROM started) AS written
  `;
  if (Number(rows[0]?.count ?? 0) > EVENTS_RATE_LIMIT) throw tooMany(retryAfter(60));
}
