import {beforeAll, describe, expect, it} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {foldEventCounts, foldResponseHours, sweepFormEvents, sweepResponseHours} from '../../src/server/intelform/housekeeping';
import {doneSet, markAllDone, markDone, sweepDoneMarkers, sweepRateLimits} from '../../src/server/intelform/notify/markers';
import {KEEP_DELIVERIES_PER_FORM, trimWebhookDeliveries} from '../../src/server/intelform/webhooks/deliver';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The background jobs' sweeps against a real Postgres at load: ~200k rows in each table they keep
 * bounded, cleared within the budget a run gives them, the sums the dashboards read unchanged by
 * the shard folds. Runs only with TEST_DATABASE_URL.
 */
const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [{id: 'f_email', type: 'email', label: 'Email', required: true}],
});

const N = 200_000;
const FORMS = 20;

async function count(table: string): Promise<number> {
  const [r] = await db.$queryRawUnsafe<{n: number}[]>(`SELECT count(*)::int AS n FROM ${table}`);
  return r!.n;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const out = await fn();
  return [out, Date.now() - t];
}

describe.skipIf(!DATABASE_URL)('housekeeping sweeps at load', () => {
  const formIds: string[] = [];

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    await db.$executeRawUnsafe('TRUNCATE "intelform_done_markers", "form_response_hours", "form_counts"');
    for (let i = 0; i < FORMS; i++) {
      const f = await db.form.create({
        data: {slug: `hk-${i}`, title: `HK ${i}`, status: 'live', draft: DEF as never, settings: defaultFormSettings() as never, theme: defaultTheme() as never},
        select: {id: true},
      });
      formIds.push(f.id);
    }
  }, 60_000);

  it('rate limits: 200k ended windows go within budget, live windows stay', async () => {
    await db.$executeRaw`
      INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
      SELECT 'respond:' || g, date_bin('60 seconds', now() - make_interval(secs => 120 + g % 3000), 'epoch'), 60, 1
      FROM generate_series(1, ${N}::int) g ON CONFLICT DO NOTHING`;
    // Live: a current minute window, an hourly window that started 30 minutes ago, and an old-style
    // done-marker still live (7 days).
    await db.$executeRaw`
      INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count) VALUES
        ('live:minute', date_bin('60 seconds', now(), 'epoch'), 60, 1),
        ('live:hour', now() - interval '30 minutes', 3600, 1),
        ('job:notify:legacy', now() - interval '3 days', 604800, 1)`;
    const [out, ms] = await timed(() => sweepRateLimits(db as never, {budgetMs: 15_000}));
    expect(out).toEqual({rows: N, more: false});
    expect(ms).toBeLessThan(15_000);
    expect(await count('intelform_rate_limits')).toBe(3);
    // The old-style marker still reads as done (the week the reads look in both tables).
    expect(await doneSet(db as never, ['job:notify:legacy', 'job:nope'])).toEqual(new Set(['job:notify:legacy']));
  }, 60_000);

  it('done-markers: their own table, expired ones swept on expires_at', async () => {
    await markDone(db as never, 'job:notify:r1');
    await markAllDone(db as never, ['job:confirm:r1', 'job:webhook:r1']);
    expect(await doneSet(db as never, ['job:notify:r1', 'job:confirm:r1', 'job:webhook:r1', 'job:x'])).toEqual(
      new Set(['job:notify:r1', 'job:confirm:r1', 'job:webhook:r1']),
    );
    await db.$executeRaw`
      INSERT INTO intelform_done_markers (key, expires_at)
      SELECT 'job:old:' || g, now() - make_interval(secs => g) FROM generate_series(1, ${N}::int) g`;
    const [out, ms] = await timed(() => sweepDoneMarkers(db as never, {budgetMs: 15_000}));
    expect(out).toEqual({rows: N, more: false});
    expect(ms).toBeLessThan(15_000);
    expect(await count('intelform_done_markers')).toBe(3);
  }, 60_000);

  it('raw form events: 200k past the keep go, recent ones stay', async () => {
    await db.$executeRaw`
      INSERT INTO form_events (form_id, type, session_token, created_at)
      SELECT (${formIds}::uuid[])[1 + g % ${FORMS}::int], 'view', 's' || g, now() - interval '3 days' - make_interval(secs => g)
      FROM generate_series(1, ${N}::int) g`;
    await db.$executeRaw`
      INSERT INTO form_events (form_id, type, session_token) VALUES (${formIds[0]}::uuid, 'view', 'fresh')`;
    const [out, ms] = await timed(() => sweepFormEvents(db as never, {budgetMs: 15_000}));
    expect(out).toEqual({rows: N, more: false});
    expect(ms).toBeLessThan(15_000);
    expect(await count('form_events')).toBe(1);
  }, 60_000);

  it('a budget too small stops with more, and the next run finishes', async () => {
    await db.$executeRaw`
      INSERT INTO form_events (form_id, type, session_token, created_at)
      SELECT ${formIds[1]}::uuid, 'start', 'b' || g, now() - interval '5 days' FROM generate_series(1, 50000) g`;
    const first = await sweepFormEvents(db as never, {budgetMs: 0});
    expect(first).toEqual({rows: 10_000, more: true});
    expect(await sweepFormEvents(db as never, {budgetMs: 15_000})).toEqual({rows: 40_000, more: false});
  }, 60_000);

  it('webhook log: 200k rows trimmed by age and to the newest 100 per busy form, with no whole-table window', async () => {
    // Half older than the keep; the other half spread over the last two hours on 20 forms.
    await db.$executeRaw`
      INSERT INTO webhook_deliveries (form_id, url, payload, status_code, created_at)
      SELECT (${formIds}::uuid[])[1 + (g / 2) % ${FORMS}::int], 'https://hooks.example.test/x', '{"a":1}'::jsonb, 200,
        CASE WHEN g % 2 = 0 THEN now() - interval '40 days' - make_interval(secs => g)
             ELSE now() - make_interval(secs => g % 7200) END
      FROM generate_series(1, ${N}::int) g`;
    const [out, ms] = await timed(() => trimWebhookDeliveries(db as never, {budgetMs: 20_000}));
    expect(out.more).toBe(false);
    expect(ms).toBeLessThan(20_000);
    expect(await count('webhook_deliveries')).toBe(FORMS * KEEP_DELIVERIES_PER_FORM);
    expect(out.rows).toBe(N - FORMS * KEEP_DELIVERIES_PER_FORM);
    // The rows kept are each form's newest.
    const [stale] = await db.$queryRaw<{n: number}[]>`
      SELECT count(*)::int AS n FROM webhook_deliveries WHERE created_at < now() - interval '1 day'`;
    expect(stale!.n).toBe(0);
  }, 60_000);

  it('hourly counts and the funnel rollup: old shards fold into shard 0 with exact sums, old hours go', async () => {
    // 16 shards for every hour of the last 4 days and some 40 days back, on every form.
    await db.$executeRaw`
      INSERT INTO form_response_hours (form_id, hour, shard, n)
      SELECT f, date_trunc('hour', now()) - make_interval(hours => h), s, 1 + (h + s) % 5 - CASE WHEN s = 0 THEN 2 ELSE 0 END
      FROM unnest(${formIds}::uuid[]) f, generate_series(0, 96) h, generate_series(0, 15) s`;
    await db.$executeRaw`
      INSERT INTO form_response_hours (form_id, hour, shard, n)
      SELECT f, date_trunc('hour', now()) - interval '40 days' - make_interval(hours => h), s, 1
      FROM unnest(${formIds}::uuid[]) f, generate_series(0, 23) h, generate_series(0, 15) s`;
    await db.$executeRaw`
      INSERT INTO form_event_counts (form_id, bucket, shard, views, starts)
      SELECT f, date_bin('15 minutes', now(), '2000-01-01') - make_interval(mins => 15 * b), s, 2, 1
      FROM unnest(${formIds}::uuid[]) f, generate_series(0, 4 * 96) b, generate_series(0, 15) s`;
    const sums = async () => {
      const [r] = await db.$queryRaw<{hours: number; views: number; starts: number}[]>`
        SELECT (SELECT sum(n) FROM form_response_hours WHERE hour > now() - interval '30 days')::int AS hours,
          (SELECT sum(views) FROM form_event_counts)::int AS views, (SELECT sum(starts) FROM form_event_counts)::int AS starts`;
      return r!;
    };
    const before = await sums();
    const [hours, ms1] = await timed(() => sweepResponseHours(db as never, {budgetMs: 15_000}));
    const [events, ms2] = await timed(() => foldEventCounts(db as never, {budgetMs: 15_000}));
    expect(hours.more).toBe(false);
    expect(events.more).toBe(false);
    expect(ms1 + ms2).toBeLessThan(30_000);
    expect(await sums()).toEqual(before);
    // 24 old hours x 16 shards x 20 forms went.
    const [old] = await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM form_response_hours WHERE hour < now() - interval '35 days'`;
    expect(old!.n).toBe(0);
    // In the fold window only shard 0 is left; outside it, nothing was touched.
    const [left] = await db.$queryRaw<{hours: number; buckets: number; recent: number}[]>`
      SELECT
        (SELECT count(*) FROM form_response_hours WHERE hour >= now() - interval '3 days' AND hour < now() - interval '2 days' AND shard <> 0)::int AS hours,
        (SELECT count(*) FROM form_event_counts WHERE bucket >= now() - interval '3 days' AND bucket < now() - interval '2 days' AND shard <> 0)::int AS buckets,
        (SELECT count(*) FROM form_event_counts WHERE bucket >= now() - interval '1 day' AND shard <> 0)::int AS recent`;
    expect(left).toEqual({hours: 0, buckets: 0, recent: expect.any(Number)});
    expect(left!.recent).toBeGreaterThan(0);
    // Running again finds nothing to fold.
    expect((await foldResponseHours(db as never, {budgetMs: 5_000})).rows).toBe(0);
  }, 120_000);
});
