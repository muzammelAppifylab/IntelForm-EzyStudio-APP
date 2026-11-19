import {describe, expect, it} from 'vitest';
import {Prisma} from '../../src/generated/prisma-node/client';
import {exactCountsJoin, exactResponsesSql, sumShards, SYNC_BATCH, syncFormCounts} from '../../src/server/intelform/forms/counts';
import {EVENTS_IP_RATE_LIMIT, EVENTS_RATE_LIMIT, handleEvent} from '../../src/server/intelform/respondent/events';

const SESSION = '6f1c1d2e-1111-4222-8333-444455556666';
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('syncFormCounts (the every-minute copy onto forms)', () => {
  it('is ONE bounded UPDATE of only the forms whose copy differs', async () => {
    const calls: {sql: string; values: unknown[]}[] = [];
    const db = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const s = Prisma.sql(strings, ...values);
        calls.push({sql: squash(s.sql), values: s.values});
        return 2;
      },
    };
    expect(await syncFormCounts(db as never)).toBe(2);
    expect(calls).toHaveLength(1);
    const {sql, values} = calls[0]!;
    // Sums every shard per form; a negative shard never makes a negative copy.
    expect(sql).toContain('FROM form_counts GROUP BY form_id');
    expect(sql).toContain('GREATEST(s.responses, 0)');
    // Writes only what changed, so an idle site writes nothing.
    expect(sql).toContain('f.response_count IS DISTINCT FROM');
    expect(sql).toContain('f.starts_total IS DISTINCT FROM');
    expect(sql).toContain('l.last_at IS DISTINCT FROM c.old_last');
    // last_response_at is the newest response that still exists (moves back after deletes).
    expect(sql).toContain('FROM responses r WHERE r.form_id = c.id ORDER BY r.submitted_at DESC LIMIT 1');
    expect(sql).toContain("LIMIT ?");
    expect(values).toEqual([SYNC_BATCH]);
    expect(sql).toMatch(/^ ?WITH .* UPDATE forms f SET response_count = c\.responses, starts_total = c\.starts, last_response_at = c\.last_at FROM changed c WHERE f\.id = c\.id/);
    // Never folds shards (no DELETE racing the triggers).
    expect(sql).not.toContain('DELETE');
  });

  it('reads the exact count inside the caller’s query, by a column reference (never a bound value)', () => {
    const one = exactResponsesSql(Prisma.sql`f.id`);
    expect(squash(one.sql)).toBe('(SELECT GREATEST(COALESCE(sum(fc.responses), 0), 0)::int FROM form_counts fc WHERE fc.form_id = f.id)');
    expect(one.values).toEqual([]);
    const page = exactCountsJoin(Prisma.sql`p.id`, Prisma.sql`fc`);
    expect(squash(page.sql)).toContain('CROSS JOIN LATERAL ( SELECT GREATEST(COALESCE(sum(responses), 0), 0)::int AS responses');
    expect(squash(page.sql)).toContain('FROM form_counts WHERE form_id = p.id ) fc');
    expect(page.values).toEqual([]);
    expect(sumShards([{responses: 5}, {responses: -2}, {responses: 1}])).toBe(4);
    expect(sumShards([{responses: -1}])).toBe(0);
    expect(sumShards([])).toBe(0);
  });
});

describe('the view/start beacon', () => {
  function fakeDb(opts: {ipCount?: number; formCount?: number; found?: boolean} = {}) {
    const calls: {sql: string; values: unknown[]}[] = [];
    const db = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const s = Prisma.sql(strings, ...values);
        const sql = squash(s.sql);
        calls.push({sql, values: s.values});
        return [{ip_count: opts.ipCount ?? 1, found: opts.found ?? true, count: opts.formCount ?? 1, written: 2}];
      },
    };
    return {db, calls};
  }

  it('ONE statement: both limits, the form, the event and its counts in one random shard', async () => {
    const {db, calls} = fakeDb();
    await handleEvent(db as never, 'Contact-Us', JSON.stringify({type: 'start', session: SESSION}), 'ipkey');
    // One round trip: the IP limit no longer goes ahead of the form read.
    expect(calls).toHaveLength(1);
    const main = calls[0]!.sql;
    expect(main).toMatch(/^ ?WITH ipl AS \( INSERT INTO intelform_rate_limits/);
    // The form only under the IP limit; the per-form window only for a found form.
    expect(main).toContain("WHERE f.slug = ? AND f.published_version_id IS NOT NULL AND f.status <> 'draft' AND (SELECT count FROM ipl) <= ?::int");
    expect(main).toContain('rl AS ( INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count) SELECT ? || f.id::text');
    expect(main).toContain('FROM f WHERE f.open AND (SELECT count FROM rl) <= ?::int ON CONFLICT DO NOTHING');
    expect(main).toContain('s AS (SELECT floor(random() * 16)::smallint AS shard)');
    expect(main).toContain('INSERT INTO form_event_counts AS ec (form_id, bucket, shard, views, starts)');
    expect(main).toContain('ON CONFLICT (form_id, bucket, shard) DO UPDATE');
    expect(main).toContain('INSERT INTO form_counts AS fc (form_id, shard, starts)');
    expect(main).toContain("WHERE ins.type = 'start' ON CONFLICT (form_id, shard) DO UPDATE SET starts = fc.starts + 1");
    // The hot forms row is never written by a beacon.
    expect(main).not.toContain('UPDATE forms');
    expect(main).not.toContain('starts_total');
    expect(calls[0]!.values).toContain(SESSION);
    expect(calls[0]!.values).toContain('contact-us');
    expect(calls[0]!.values).toContain('events:ip:ipkey');
    expect(calls[0]!.values).toContain('events:ipkey:');
  });

  it('per-IP ceilings are generous enough for a school or office behind one address', async () => {
    expect(EVENTS_RATE_LIMIT).toBeGreaterThanOrEqual(600);
    expect(EVENTS_IP_RATE_LIMIT).toBeGreaterThanOrEqual(1200);
    await expect(handleEvent(fakeDb({ipCount: EVENTS_IP_RATE_LIMIT}).db as never, 'contact-us', JSON.stringify({type: 'view', session: SESSION}), 'k')).resolves.toBeUndefined();
    await expect(handleEvent(fakeDb({ipCount: EVENTS_IP_RATE_LIMIT + 1, found: false}).db as never, 'contact-us', JSON.stringify({type: 'view', session: SESSION}), 'k')).rejects.toMatchObject({status: 429});
    await expect(handleEvent(fakeDb({formCount: EVENTS_RATE_LIMIT + 1}).db as never, 'contact-us', JSON.stringify({type: 'view', session: SESSION}), 'k')).rejects.toMatchObject({status: 429});
  });

  it('unknown, draft and malformed slugs are 404s (a malformed one without a query)', async () => {
    await expect(handleEvent(fakeDb({found: false}).db as never, 'nope', JSON.stringify({type: 'view', session: SESSION}), 'k')).rejects.toMatchObject({status: 404});
    const {db, calls} = fakeDb();
    await expect(handleEvent(db as never, '../etc', JSON.stringify({type: 'view', session: SESSION}), 'k')).rejects.toMatchObject({status: 404});
    expect(calls).toHaveLength(0);
  });

  it('open: live, before its close date, and under its cap by the exact count', async () => {
    const {db, calls} = fakeDb();
    await handleEvent(db as never, 'contact-us', JSON.stringify({type: 'view', session: SESSION}), 'k');
    const sql = calls[0]!.sql;
    expect(sql).toContain("(f.status = 'live' AND (intelform_try_timestamptz(f.settings->>'closeAt') IS NULL OR intelform_try_timestamptz(f.settings->>'closeAt') > now())");
    expect(sql).toContain("AND NOT coalesce(jsonb_typeof(f.settings->'responseCap') = 'number' AND (SELECT GREATEST(COALESCE(sum(fc.responses), 0), 0)::int FROM form_counts fc WHERE fc.form_id = f.id) >= (f.settings->>'responseCap')::numeric, false)) AS open");
  });
});
