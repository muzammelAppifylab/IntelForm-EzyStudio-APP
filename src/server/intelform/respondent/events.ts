import type {PrismaClient} from '../../../generated/prisma/client';
import {formEventInput} from '../../../lib/intelform/api-public';
import {RespondentError} from './errors';
import {isClosed, requireFormMeta} from './load';
import {rateLimit} from './rate-limit';

/**
 * Funnel events (view, start) from the respondent page. One per type per session token: the
 * insert dedupes with ON CONFLICT DO NOTHING and the 15-minute rollup (form_event_counts) is
 * bumped in the same statement only for rows actually inserted. Completions are the responses
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
  // Per IP before the form load (a flood of made-up slugs costs one upsert each, under one key),
  // then per IP and form once the form is known: never a key per attacker-chosen slug.
  await rateLimit(db, `events:ip:${ipKey}`, EVENTS_IP_RATE_LIMIT, 60);
  const form = await requireFormMeta(db, slug);
  await rateLimit(db, `events:${ipKey}:${form.id}`, EVENTS_RATE_LIMIT, 60);
  if (isClosed(form)) return;
  await db.$queryRaw`
    WITH ins AS (
      INSERT INTO form_events (form_id, type, session_token) VALUES (${form.id}::uuid, ${type}, ${session})
      ON CONFLICT DO NOTHING
      RETURNING form_id, type, created_at
    )
    INSERT INTO form_event_counts (form_id, bucket, views, starts)
    SELECT form_id, date_bin('15 minutes', created_at, '2000-01-01'::timestamptz), (type = 'view')::int, (type = 'start')::int FROM ins
    ON CONFLICT (form_id, bucket) DO UPDATE SET
      views = form_event_counts.views + EXCLUDED.views,
      starts = form_event_counts.starts + EXCLUDED.starts
    RETURNING 1
  `;
}
