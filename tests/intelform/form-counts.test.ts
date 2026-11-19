import {describe, expect, it} from 'vitest';
import {Prisma} from '../../src/generated/prisma-node/client';
import {exactCountsJoin, exactResponsesSql, sumShards, SYNC_BATCH, syncFormCounts} from '../../src/server/intelform/forms/counts';
import {EVENTS_IP_RATE_LIMIT, handleEvent} from '../../src/server/intelform/respondent/events';

const SESSION = '6f1c1d2e-1111-4222-8333-444455556666';
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('syncFormCounts (the copy onto forms, for marked forms only)', () => {
  it('is ONE bounded statement over the dirty markers, writing only what changed', async () => {
    const calls: {sql: string; values: unknown[]}[] = [];
    const db = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const s = Prisma.sql(strings, ...values);
        calls.push({sql: squash(s.sql), values: s.values});
        return [{updated: 2, cleared: 3}];
      },
    };
    expect(await syncFormCounts(db as never)).toBe(2);
    expect(calls).toHaveLength(1);
    const {sql, values} = calls[0]!;
    // Only marked forms (an idle site reads one empty range of the markers' primary key).
    expect(sql).toContain("SELECT DISTINCT form_id FROM intelform_dirty_forms WHERE kind = 'c' ORDER BY form_id LIMIT ?");
    expect(sql).not.toMatch(/FROM form_counts GROUP BY form_id/);
    // Sums the marked forms' shards; a negative shard never makes a negative copy.
    expect(sql).toContain('GREATEST(coalesce(sum(fc.responses), 0), 0)');
    // Writes only what changed.
    expect(sql).toContain('c.response_count IS DISTINCT FROM c.responses');
    expect(sql).toContain('c.starts_total IS DISTINCT FROM c.starts');
    expect(sql).toContain('c.last_response_at IS DISTINCT FROM c.last_at');
    // last_response_at is the newest response that still exists (moves back after deletes).
    expect(sql).toContain('FROM responses r WHERE r.form_id = f.id ORDER BY r.submitted_at DESC LIMIT 1');
    expect(values).toEqual([SYNC_BATCH]);
    // Markers of minutes that ended a while ago go; the shards are never folded.
    expect(sql).toContain("DELETE FROM intelform_dirty_forms d USING marked m WHERE d.kind = 'c'");
    expect(sql).toContain("interval '90 seconds'");
    expect(sql).not.toContain('DELETE FROM form_counts');
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

  it('ONE statement: the IP limit, the form, the event, its counts in one random shard and the markers', async () => {
    const {db, calls} = fakeDb();
    await handleEvent(db as never, 'Contact-Us', JSON.stringify({type: 'start', session: SESSION}), 'ipkey');
    // One round trip: the IP limit no longer goes ahead of the form read.
    expect(calls).toHaveLength(1);
    const main = calls[0]!.sql;
    expect(main).toMatch(/^ ?WITH ipl AS \( INSERT INTO intelform_rate_limits/);
    // The form only under the IP limit; ONE rate-limit row per beacon (no per-form window).
    expect(main).toContain("WHERE f.slug = ? AND f.published_version_id IS NOT NULL AND f.status <> 'draft' AND (SELECT count FROM ipl) <= ?::int");
    expect(main.match(/INSERT INTO intelform_rate_limits/g)).toHaveLength(1);
    expect(main).toContain('FROM f WHERE f.open ON CONFLICT DO NOTHING');
    // Dirty markers: the Summary's (`e`), and the counters' (`c`) for a start; no lock when there.
    expect(main).toContain("INSERT INTO intelform_dirty_forms (kind, bucket, form_id)");
    expect(main).toContain("SELECT 'c' WHERE ins.type = 'start'");
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
    expect(calls[0]!.values).not.toContain('events:ipkey:');
  });

  it('the per-IP ceiling is generous enough for a school or office behind one address', async () => {
    expect(EVENTS_IP_RATE_LIMIT).toBeGreaterThanOrEqual(1200);
    await expect(handleEvent(fakeDb({ipCount: EVENTS_IP_RATE_LIMIT}).db as never, 'contact-us', JSON.stringify({type: 'view', session: SESSION}), 'k')).resolves.toBeUndefined();
    await expect(handleEvent(fakeDb({ipCount: EVENTS_IP_RATE_LIMIT + 1, found: false}).db as never, 'contact-us', JSON.stringify({type: 'view', session: SESSION}), 'k')).rejects.toMatchObject({status: 429});
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
