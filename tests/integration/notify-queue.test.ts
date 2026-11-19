import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {drainNotifyQueue} from '../../src/server/intelform/notify';
import {syncFormCounts} from '../../src/server/intelform/forms/counts';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The every-minute job against a real Postgres: the notify queue's claim statement (SKIP LOCKED,
 * back-off, two runs at once never taking the same row), and the forms list's copy of the
 * sharded counters (syncFormCounts). Runs only with TEST_DATABASE_URL.
 */
const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [{id: 'f_email', type: 'email', label: 'Email', required: true}],
});

async function formWithResponses(n: number): Promise<{formId: string; ids: string[]}> {
  const form = await db.form.create({
    data: {slug: `q-${Date.now()}-${n}`, title: 'Queue', status: 'live', draft: DEF as never, settings: defaultFormSettings() as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  const v = await db.formVersion.create({data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never}, select: {id: true}});
  const rows = await db.$queryRaw<{id: string}[]>`
    INSERT INTO responses (form_id, form_version_id, answers)
    SELECT ${form.id}::uuid, ${v.id}::uuid, jsonb_build_object('f_email', 'p' || g || '@example.com')
    FROM generate_series(1, ${n}::int) g
    RETURNING id::text
  `;
  return {formId: form.id, ids: rows.map(r => r.id)};
}

const queued = async () => Number((await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM intelform_notify_queue`)[0]?.n ?? 0);

describe.skipIf(!DATABASE_URL)('every-minute job (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);

  it('works through the queue once, even with two runs at the same time', async () => {
    const {ids} = await formWithResponses(40);
    await db.$executeRaw`INSERT INTO intelform_notify_queue (response_id) SELECT unnest(${ids}::uuid[])`;
    const seen: string[] = [];
    const work = async (id: string) => {
      seen.push(id);
      await new Promise(r => setTimeout(r, 5));
    };
    const [a, b] = await Promise.all([
      drainNotifyQueue(db, 'http://localhost/', {work}),
      drainNotifyQueue(db, 'http://localhost/', {work}),
    ]);
    // Every response handled exactly once, across both runs, and the queue is empty.
    expect(new Set(seen).size).toBe(40);
    expect(seen.length).toBe(40);
    expect(a.done + b.done).toBe(40);
    expect(await queued()).toBe(0);
  });

  it('keeps a failed response for a later try, and the next run does not take it before its back-off', async () => {
    const {ids} = await formWithResponses(3);
    await db.$executeRaw`INSERT INTO intelform_notify_queue (response_id) SELECT unnest(${ids}::uuid[])`;
    const bad = ids[0]!;
    const first = await drainNotifyQueue(db, 'http://localhost/', {
      work: async id => {
        if (id === bad) throw new Error('mail down');
      },
    });
    expect(first.done).toBe(2);
    expect(first.failed).toBe(1);
    const [row] = await db.$queryRaw<{attempts: number; claimed: boolean}[]>`
      SELECT attempts, claimed_at IS NOT NULL AS claimed FROM intelform_notify_queue WHERE response_id = ${bad}::uuid`;
    expect(row).toEqual({attempts: 1, claimed: true});

    const again: string[] = [];
    await drainNotifyQueue(db, 'http://localhost/', {work: async id => void again.push(id)});
    expect(again).toEqual([]); // still within its back-off
    expect(await queued()).toBe(1);
  });

  it('a deleted response leaves the queue with it', async () => {
    const {ids} = await formWithResponses(2);
    await db.$executeRaw`INSERT INTO intelform_notify_queue (response_id) SELECT unnest(${ids}::uuid[])`;
    await db.$executeRaw`DELETE FROM responses WHERE id = ${ids[0]!}::uuid`;
    expect(await queued()).toBe(1);
  });

  it('copies the sharded counts to the forms row, and writes nothing when nothing moved', async () => {
    const {formId, ids} = await formWithResponses(7);
    await db.$executeRaw`DELETE FROM responses WHERE id = ${ids[0]!}::uuid`;
    const [shards] = await db.$queryRaw<{n: number}[]>`SELECT coalesce(sum(responses), 0)::int AS n FROM form_counts WHERE form_id = ${formId}::uuid`;
    expect(shards?.n).toBe(6);

    expect(await syncFormCounts(db)).toBeGreaterThanOrEqual(1);
    const form = await db.form.findUniqueOrThrow({where: {id: formId}, select: {responseCount: true, lastResponseAt: true}});
    expect(form.responseCount).toBe(6);
    expect(form.lastResponseAt).not.toBeNull();

    expect(await syncFormCounts(db)).toBe(0);
  });
});
