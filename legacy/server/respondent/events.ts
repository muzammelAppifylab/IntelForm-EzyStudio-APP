import type { Context } from 'hono'
import { formEventInput } from '../../shared/api-public'
import { sql } from '../db/client'
import { ApiError } from '../lib/errors'
import { ipKey } from '../lib/ip'
import { rateLimit } from '../lib/rate-limit'
import { isClosed, requireFormMeta } from './load'

/**
 * Funnel events (view, start) from sendBeacon. One per type per session token: the insert
 * dedupes with ON CONFLICT DO NOTHING and the 15-minute rollup is bumped in the same statement
 * only for rows actually inserted (docs/research/05-data-analytics.md "Funnel events").
 */
export const EVENTS_RATE_LIMIT = 30
/** Events per IP per minute across all forms (a page sends a view and a start per form). */
export const EVENTS_IP_RATE_LIMIT = 120

export async function handleEvent(c: Context, slug: string): Promise<void> {
  let raw: unknown
  try {
    // sendBeacon posts text/plain (no preflight); fetch posts JSON. Both are JSON text.
    raw = JSON.parse(await c.req.text())
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body must be JSON')
  }
  const parsed = formEventInput.safeParse(raw)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Unknown event')
  // Per IP before the form load (so a flood of made-up slugs costs one upsert each, under one
  // key), then per IP and form once the form is known: never a key per attacker-chosen slug.
  const ip = ipKey(c)
  await rateLimit(`events:ip:${ip}`, EVENTS_IP_RATE_LIMIT, 60)
  const form = await requireFormMeta(slug)
  await rateLimit(`events:${ip}:${form.id}`, EVENTS_RATE_LIMIT, 60)
  if (isClosed(form)) return
  const { type, session } = parsed.data
  await sql`
    WITH ins AS (
      INSERT INTO form_events (form_id, type, session_token) VALUES (${form.id}, ${type}, ${session})
      ON CONFLICT DO NOTHING
      RETURNING form_id, type, created_at
    )
    INSERT INTO form_event_counts (form_id, bucket, views, starts)
    SELECT form_id, date_bin('15 minutes', created_at, '2000-01-01'), (type = 'view')::int, (type = 'start')::int FROM ins
    ON CONFLICT (form_id, bucket) DO UPDATE SET
      views = form_event_counts.views + EXCLUDED.views,
      starts = form_event_counts.starts + EXCLUDED.starts
  `
}
