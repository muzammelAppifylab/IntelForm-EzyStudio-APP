import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {
  CONFIRM_EMAIL_LIMIT,
  drainNotifyQueue,
  NOTIFY_EMAILS_PER_HOUR,
  NotifyDeferred,
  notifyRun,
  notifyStats,
  runResponseNotify,
  sendOwnerDigests,
  type MailMessage,
  type MailProvider,
} from '../../src/server/intelform/notify';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The faster notify drain against a real Postgres: the claim reads only due rows (`next_at`), a
 * held-back row goes back uncounted, the per-form hourly counts (intelform_notify_hours) feed the
 * digest and the builder's numbers. Runs only with TEST_DATABASE_URL.
 */
const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [{id: 'f_email', type: 'email', label: 'Email', required: true}],
});

async function formWithResponses(n: number, settings: Record<string, unknown> = {}): Promise<{formId: string; ids: string[]}> {
  const form = await db.form.create({
    data: {
      slug: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Speed',
      status: 'live',
      draft: DEF as never,
      settings: {...defaultFormSettings(), ...settings} as never,
      theme: defaultTheme() as never,
    },
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

const hours = async (formId: string) =>
  (
    await db.$queryRaw<{notified: number; digest_pending: number; digest_sent: number; confirmed: number; confirm_capped: number}[]>`
      SELECT notified, digest_pending, digest_sent, confirmed, confirm_capped FROM intelform_notify_hours WHERE form_id = ${formId}::uuid`
  )[0];

function fakeMail(): MailProvider & {sent: MailMessage[]} {
  const sent: MailMessage[] = [];
  return {name: 'resend', from: 'f@acme.test', sent, send: async m => void sent.push(m)};
}

describe.skipIf(!DATABASE_URL)('notify drain speed and email limits (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);

  it('claims only due rows, sets the back-off on the claim, and gives a held-back row back uncounted', async () => {
    const {ids} = await formWithResponses(4);
    await db.$executeRaw`INSERT INTO intelform_notify_queue (response_id) SELECT unnest(${ids}::uuid[])`;
    // One row is in its back-off: not due, never claimed.
    await db.$executeRaw`UPDATE intelform_notify_queue SET next_at = now() + interval '10 minutes', attempts = 1 WHERE response_id = ${ids[0]!}::uuid`;
    const seen: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await drainNotifyQueue(db, 'http://localhost/', {
      work: async id => {
        seen.push(id);
        if (id === ids[1]) throw new Error('mail down');
        if (id === ids[2]) throw new NotifyDeferred('held back');
      },
    });
    warn.mockRestore();
    expect(seen.sort()).toEqual([ids[1]!, ids[2]!, ids[3]!].sort());
    expect(out).toEqual({done: 1, failed: 1, more: false});
    const rows = await db.$queryRaw<{id: string; attempts: number; mins: number}[]>`
      SELECT response_id::text AS id, attempts, round(extract(epoch FROM next_at - now()) / 60)::int AS mins
      FROM intelform_notify_queue ORDER BY response_id`;
    const by = new Map(rows.map(r => [r.id, r]));
    expect(by.get(ids[1]!)).toMatchObject({attempts: 1, mins: 2}); // failed: its back-off
    expect(by.get(ids[2]!)).toMatchObject({attempts: 0, mins: 5}); // held back: uncounted
    expect(by.has(ids[3]!)).toBe(false);

    // The claim's plan uses the next_at index (the back-off rows are never scanned).
    await db.$executeRawUnsafe('SET enable_seqscan = off');
    const plan = await db.$queryRawUnsafe<{'QUERY PLAN': string}[]>(
      'EXPLAIN SELECT response_id FROM intelform_notify_queue WHERE next_at <= now() ORDER BY next_at LIMIT 25 FOR UPDATE SKIP LOCKED'
    );
    await db.$executeRawUnsafe('RESET enable_seqscan');
    expect(plan.map(p => p['QUERY PLAN']).join('\n')).toContain('intelform_notify_queue_next_at_idx');
  });

  it('counts the hour per form, emails the first ones, and sends the rest as ONE digest after the hour', async () => {
    const n = NOTIFY_EMAILS_PER_HOUR + 4;
    const {formId, ids} = await formWithResponses(n, {notifyOnResponse: true});
    const relay = vi.fn(async (_p: string) => 'sent' as const);
    const run = notifyRun(db, {relay, mail: null, origin: null});
    await run.preload(ids);
    const outs = [];
    for (const id of ids) outs.push((await runResponseNotify(db, {responseId: id}, {run})).notified);
    expect(relay).toHaveBeenCalledTimes(NOTIFY_EMAILS_PER_HOUR);
    expect(outs.filter(o => o === 'digest')).toHaveLength(4);
    expect(await hours(formId)).toMatchObject({notified: n, digest_pending: 4, digest_sent: 0});

    // Run again (a retry): nothing counted or sent twice.
    for (const id of ids) await runResponseNotify(db, {responseId: id}, {relay, mail: null, origin: null});
    expect(relay).toHaveBeenCalledTimes(NOTIFY_EMAILS_PER_HOUR);
    expect(await hours(formId)).toMatchObject({notified: n, digest_pending: 4});

    // Within the hour: no digest yet.
    const digestRelay = vi.fn(async (_p: string) => 'sent' as const);
    expect(await sendOwnerDigests(db, 'http://localhost/', {budgetMs: 10_000, relay: digestRelay, mail: null})).toEqual({sent: 0});
    // After the hour: one email, then marked.
    await db.$executeRaw`UPDATE intelform_notify_hours SET hour = hour - interval '1 hour' WHERE form_id = ${formId}::uuid`;
    expect(await sendOwnerDigests(db, 'http://localhost/', {budgetMs: 10_000, relay: digestRelay, mail: null})).toEqual({sent: 1});
    expect(digestRelay).toHaveBeenCalledWith(`/dashboard/forms/${formId}/responses`);
    expect(await hours(formId)).toMatchObject({digest_pending: 4, digest_sent: 4});
    expect(await sendOwnerDigests(db, 'http://localhost/', {budgetMs: 10_000, relay: digestRelay, mail: null})).toEqual({sent: 0});
    expect(digestRelay).toHaveBeenCalledTimes(1);
    expect((await notifyStats(db, formId))?.digested).toBe(4);
  });

  it('keeps a digest the platform refused (429) for the next run', async () => {
    const {formId, ids} = await formWithResponses(1, {notifyOnResponse: true});
    // The platform's own limit refuses the one-by-one email: it joins the digest.
    const limited = vi.fn(async () => 'limited' as const);
    expect((await runResponseNotify(db, {responseId: ids[0]!}, {relay: limited, mail: null, origin: null})).notified).toBe('digest');
    await db.$executeRaw`UPDATE intelform_notify_hours SET hour = hour - interval '1 hour' WHERE form_id = ${formId}::uuid`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendOwnerDigests(db, 'http://localhost/', {budgetMs: 10_000, relay: limited, mail: null})).toEqual({sent: 0});
    warn.mockRestore();
    expect(await hours(formId)).toMatchObject({digest_pending: 1, digest_sent: 0});
    const ok = vi.fn(async () => 'sent' as const);
    expect(await sendOwnerDigests(db, 'http://localhost/', {budgetMs: 10_000, relay: ok, mail: null})).toEqual({sent: 1});
    expect(await hours(formId)).toMatchObject({digest_sent: 1});
  });

  it('counts confirmations held back by the cap, and shows them in the form stats', async () => {
    const {formId, ids} = await formWithResponses(3, {confirmationEmail: true, confirmationEmailFieldId: 'f_email'});
    await db.$executeRaw`
      INSERT INTO intelform_notify_hours (form_id, hour, confirmed) VALUES (${formId}::uuid, date_trunc('hour', now()), ${CONFIRM_EMAIL_LIMIT - 1}::int)`;
    const mail = fakeMail();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outs = [];
    for (const id of ids) outs.push((await runResponseNotify(db, {responseId: id}, {relay: vi.fn(), mail, origin: null})).confirmation);
    expect(outs).toEqual(['sent', 'capped', 'capped']);
    expect(warn.mock.calls.filter(c => String(c[0]).includes('hourly limit'))).toHaveLength(1);
    warn.mockRestore();
    expect(mail.sent).toHaveLength(1);
    expect(await notifyStats(db, formId)).toMatchObject({cappedConfirmations: 2, confirmLimit: CONFIRM_EMAIL_LIMIT});
    expect(await notifyStats(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
