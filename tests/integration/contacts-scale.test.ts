import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {Prisma} from '../../src/generated/prisma-node/client';
import {contactsCsvQuery, contactsListQuery, CONTACT_SORTS, type ContactSort} from '../../src/lib/intelform/api-contacts';
import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {defaultTheme} from '../../src/lib/intelform/form/theme';
import {clearContactsOverview, contactDetail, contactsCsvBatch, contactsOverview, listContacts} from '../../src/server/intelform/contacts/query';
import {CONTACT_COLUMNS, pageSql, type ContactCursor} from '../../src/server/intelform/contacts/sql';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The contacts table at scale against a real Postgres (TEST_DATABASE_URL): ~50k contacts, every
 * sort and direction read by index (first page and page N), the keyset walks every contact once
 * in order, a burst of 200 submits from one email beside 200 others stays exact, and deletes
 * (retention-sized, one response of a big contact, a whole form) keep every contact exact
 * without the full re-aggregate.
 */

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [
    {id: 'f_name', type: 'name', label: 'Your name', required: false, props: {split: true}},
    {id: 'f_email', type: 'email', label: 'Email', required: false},
    {id: 'f_phone', type: 'phone', label: 'Phone', required: false},
  ],
});

const CONTACTS = 50_000;
const BIG = 'e:big@x.io';
let forms: {id: string; versionId: string}[] = [];

async function makeForm(i: number) {
  const s = defaultFormSettings();
  const form = await db.form.create({
    data: {slug: `c-${i}`, title: `Form ${i}`, status: 'live', draft: DEF as never, settings: s as never, theme: defaultTheme() as never},
    select: {id: true},
  });
  const v = await db.formVersion.create({data: {formId: form.id, version: 1, definition: DEF as never, theme: defaultTheme() as never}, select: {id: true}});
  return {id: form.id, versionId: v.id};
}

/** Contacts rows that differ from a full re-aggregate of responses (0 = exact). */
async function drift(): Promise<number> {
  const [row] = await db.$queryRaw<{bad: number}[]>`
    WITH e AS (
      SELECT r.contact_key AS key, count(*)::int AS n, min(r.submitted_at) AS f, max(r.submitted_at) AS l,
        (array_agg(r.contact_email ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_email IS NOT NULL))[1] AS email,
        (array_agg(r.contact_name ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_name IS NOT NULL))[1] AS name,
        (array_agg(r.contact_phone ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_phone IS NOT NULL))[1] AS phone,
        (array_agg(r.country ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.country IS NOT NULL))[1] AS country,
        ARRAY(SELECT DISTINCT x FROM unnest(array_agg(r.form_id)) AS x ORDER BY x) AS forms
      FROM responses r WHERE r.contact_key IS NOT NULL GROUP BY r.contact_key
    )
    SELECT count(*)::int AS bad FROM e FULL JOIN contacts c ON c.key = e.key
    WHERE e.key IS NULL OR c.key IS NULL OR c.n <> e.n OR c.first_seen <> e.f OR c.last_seen <> e.l
      OR c.email IS DISTINCT FROM e.email OR c.name IS DISTINCT FROM e.name OR c.phone IS DISTINCT FROM e.phone
      OR c.country IS DISTINCT FROM e.country
      OR ARRAY(SELECT x FROM unnest(c.form_ids) AS x ORDER BY x) <> e.forms OR c.form_count <> cardinality(e.forms)
  `;
  return Number(row!.bad);
}

async function plan(sql: Prisma.Sql): Promise<string> {
  const rows = await db.$queryRaw<{'QUERY PLAN': string}[]>`EXPLAIN ${sql}`;
  return rows.map(r => r['QUERY PLAN']).join('\n');
}

const INDEX: Record<ContactSort, string> = {
  last_seen: 'contacts_last_seen_key_idx',
  first_seen: 'contacts_first_seen_key_idx',
  name: 'contacts_name_key_idx',
  email: 'contacts_email_key_idx',
  responses: 'contacts_n_key_idx',
};

describe.skipIf(!DATABASE_URL)('contacts at scale (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    forms = [await makeForm(1), await makeForm(2), await makeForm(3)];
    const fids = forms.map(f => f.id);
    const vids = forms.map(f => f.versionId);
    // 60k responses over 50k contacts (some answer 2 forms), 1 in 25 by phone only, 1 in 7 with no name.
    await db.$executeRaw`
      INSERT INTO responses (form_id, form_version_id, answers, submitted_at, country)
      SELECT (${fids}::uuid[])[1 + i % 3], (${vids}::uuid[])[1 + i % 3],
        jsonb_build_object(
          'f_email', CASE WHEN (i % ${CONTACTS}) % 25 = 0 THEN NULL ELSE 'u' || (i % ${CONTACTS}) || '@x.io' END,
          'f_phone', '+1555' || lpad((i % ${CONTACTS})::text, 7, '0'),
          'f_name', CASE WHEN i % 7 = 0 THEN NULL ELSE jsonb_build_object('first', 'N' || (i % 997), 'last', 'L') END),
        now() - make_interval(secs => i * 37), (ARRAY['GB', 'US', 'FR', 'DE', NULL])[1 + i % 5]
      FROM generate_series(1, 60000) AS i
    `;
    // One big contact: 3,000 responses on every form.
    await db.$executeRaw`
      INSERT INTO responses (form_id, form_version_id, answers, submitted_at, country)
      SELECT (${fids}::uuid[])[1 + i % 3], (${vids}::uuid[])[1 + i % 3],
        jsonb_build_object('f_email', 'big@x.io', 'f_name', CASE WHEN i % 2 = 0 THEN NULL ELSE jsonb_build_object('first', 'Big', 'last', i::text) END),
        now() - make_interval(secs => i * 11), CASE WHEN i % 3 = 0 THEN 'NL' END
      FROM generate_series(1, 3000) AS i
    `;
    await db.$executeRaw`ANALYZE contacts`;
    await db.$executeRaw`ANALYZE responses`;
  }, 300_000);
  afterAll(() => db.$disconnect());

  it('keeps every contact exact after a big insert, forms most recent first', async () => {
    expect(await drift()).toBe(0);
    const [n] = await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM contacts`;
    expect(Number(n!.n)).toBe(CONTACTS + 1);
    const [big] = await db.$queryRaw<{n: number; form_count: number; first: string}[]>`
      SELECT n, form_count, form_ids[1]::text AS first FROM contacts WHERE key = ${BIG}`;
    expect(big).toMatchObject({n: 3000, form_count: 3});
    // The latest response (i = 1) is on form 2.
    expect(big!.first).toBe(forms[1]!.id);
  });

  it('reads every sort and direction by its index, first page and page N, with no Sort over the table', async () => {
    const where = Prisma.sql`true`;
    for (const sort of CONTACT_SORTS) {
      for (const dir of ['asc', 'desc'] as const) {
        // Page N: the cursor from row 20,000 in that order.
        const [mid] = await db.$queryRaw<{sort_v: string | null; key: string}[]>`
          SELECT * FROM (${pageSql(sort, dir, where, null, 20_000, CONTACT_COLUMNS)}) p OFFSET 19999 LIMIT 1`;
        const cursors: (ContactCursor | null)[] = [null, {v: mid!.sort_v, k: mid!.key}];
        for (const cur of cursors) {
          const text = await plan(pageSql(sort, dir, where, cur, 51, CONTACT_COLUMNS));
          expect(text, `${sort} ${dir} ${cur ? 'page N' : 'first'}\n${text}`).toContain(INDEX[sort]);
          expect(text, `${sort} ${dir}\n${text}`).not.toContain('Seq Scan');
          if (cur && sort !== 'name' && sort !== 'email') expect(text).toMatch(/Index Cond: \(ROW\(/);
        }
      }
    }
  }, 120_000);

  it('walks every contact once, in order, a CSV batch at a time (O(n): one index range per batch)', async () => {
    const [{total}] = (await db.$queryRaw<{total: number}[]>`SELECT count(*)::int AS total FROM contacts`) as [{total: number}];
    for (const [sort, dir] of [
      ['name', 'asc'],
      ['email', 'desc'],
      ['responses', 'desc'],
      ['last_seen', 'asc'],
    ] as const) {
      const q = contactsCsvQuery.parse({sort, dir});
      const seen = new Set<string>();
      let cur: ContactCursor | null = null;
      let rows = 0;
      let batches = 0;
      const started = Date.now();
      do {
        const b = await contactsCsvBatch(db, q, 'UTC', cur);
        rows += b.rows;
        batches++;
        for (const line of b.text.split('\r\n').filter(Boolean)) seen.add(line);
        cur = b.next;
      } while (cur && batches < 100);
      expect(rows, `${sort} ${dir}`).toBe(Number(total));
      expect(seen.size, `${sort} ${dir}: no row twice`).toBe(Number(total));
      // 51 batches over 50k contacts: well under a few seconds when each batch is an index range.
      expect(Date.now() - started, `${sort} ${dir}`).toBeLessThan(20_000);
    }
    // The list pages agree with a plain ORDER BY on the same columns.
    const page1 = await listContacts(db, contactsListQuery.parse({sort: 'name', dir: 'desc'}), 'UTC');
    const page2 = await listContacts(db, contactsListQuery.parse({sort: 'name', dir: 'desc', cursor: page1.nextCursor}), 'UTC');
    const ref = await db.$queryRaw<{key: string}[]>`
      SELECT key FROM contacts ORDER BY (name IS NULL), lower(name) DESC, key DESC LIMIT 100`;
    expect([...page1.contacts, ...page2.contacts].map(c => c.key)).toEqual(ref.map(r => r.key));
    expect(page1.contacts[0]!.forms.length).toBeGreaterThan(0);
    // Previous from page 2 is page 1 again; the last page is the tail of the same order.
    const back = await listContacts(db, contactsListQuery.parse({sort: 'name', dir: 'desc', before: page2.prevCursor}), 'UTC');
    expect(back.contacts.map(c => c.key)).toEqual(page1.contacts.map(c => c.key));
    expect(back.prevCursor).toBeNull();
    const tail = await listContacts(db, contactsListQuery.parse({sort: 'name', dir: 'desc', last: 30}), 'UTC');
    const refTail = await db.$queryRaw<{key: string}[]>`
      SELECT key FROM contacts ORDER BY (name IS NULL) DESC, lower(name) ASC, key ASC LIMIT 30`;
    expect(tail.contacts.map(c => c.key)).toEqual(refTail.map(r => r.key).reverse());
    expect(tail.nextCursor).toBeNull();
  }, 120_000);

  it('a burst of 200 submits from one email beside 200 others: no timeout, counts exact', async () => {
    const [{before}] = (await db.$queryRaw<{before: number}[]>`SELECT n AS before FROM contacts WHERE key = 'e:hot@x.io'
      UNION ALL SELECT 0 LIMIT 1`) as [{before: number}];
    const f = forms[0]!;
    const insert = (email: string) => db.$executeRaw`
      INSERT INTO responses (form_id, form_version_id, answers, country)
      VALUES (${f.id}::uuid, ${f.versionId}::uuid, jsonb_build_object('f_email', ${email}::text, 'f_name', 'Hot'), 'GB')`;
    const started = Date.now();
    await Promise.all(Array.from({length: 400}, (_, i) => insert(i % 2 ? 'hot@x.io' : `other${i}@x.io`)));
    expect(Date.now() - started).toBeLessThan(30_000);
    const [hot] = await db.$queryRaw<{n: number}[]>`SELECT n FROM contacts WHERE key = 'e:hot@x.io'`;
    expect(Number(hot!.n)).toBe(Number(before) + 200);
    const [shards] = await db.$queryRaw<{n: number}[]>`SELECT sum(responses)::int AS n FROM form_counts WHERE form_id = ${f.id}::uuid`;
    const [rows] = await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM responses WHERE form_id = ${f.id}::uuid`;
    expect(Number(shards!.n)).toBe(Number(rows!.n));
    expect(await drift()).toBe(0);
  }, 60_000);

  it('deletes stay exact incrementally: a retention batch, a big contact’s latest response, a whole form', async () => {
    // A retention-sized batch (oldest 500), inside a transaction: the refresh found it done.
    const left = await db.$transaction(async tx => {
      await tx.$executeRaw`DELETE FROM responses WHERE id IN (SELECT id FROM responses ORDER BY submitted_at ASC LIMIT 500)`;
      const [s] = await tx.$queryRaw<{v: string | null}[]>`SELECT current_setting('intelform.contacts_done', true) AS v`;
      return s!.v;
    }, {timeout: 60_000});
    expect(left).toBe('');
    expect(await drift()).toBe(0);

    // The big contact's latest response (its last seen, its form order and its latest name come from it).
    await db.$executeRaw`DELETE FROM responses WHERE id = (SELECT id FROM responses WHERE contact_key = ${BIG} ORDER BY submitted_at DESC LIMIT 1)`;
    // And every response with its current name and country.
    await db.$executeRaw`DELETE FROM responses r USING contacts c WHERE c.key = ${BIG} AND r.contact_key = c.key AND (r.contact_name = c.name OR r.country = c.country)`;
    expect(await drift()).toBe(0);

    // Some contacts lose everything; an update of answers rebuilds.
    await db.$executeRaw`DELETE FROM responses WHERE contact_key IN ('e:u1@x.io', 'e:u2@x.io', 'p:+15550000025')`;
    await db.$executeRaw`UPDATE responses SET answers = answers || '{"f_email": "moved@x.io"}' WHERE id = (SELECT id FROM responses WHERE contact_key = 'e:u3@x.io' LIMIT 1)`;
    expect(await drift()).toBe(0);

    // A whole form (cascade).
    await db.$executeRaw`DELETE FROM forms WHERE id = ${forms[2]!.id}::uuid`;
    expect(await drift()).toBe(0);
  }, 120_000);

  it('the detail: forms most recent first with bounded counts; the latest 200 responses', async () => {
    await db.$executeRaw`
      INSERT INTO responses (form_id, form_version_id, answers, submitted_at)
      SELECT ${forms[0]!.id}::uuid, ${forms[0]!.versionId}::uuid, '{"f_email": "big@x.io"}', now() - make_interval(secs => i)
      FROM generate_series(1, 1500) AS i`;
    const d = await contactDetail(db, BIG);
    expect(d!.forms.map(f => f.id)[0]).toBe(forms[0]!.id);
    expect(d!.forms[0]!.responses).toBe(1001);
    expect(d!.responses).toHaveLength(200);
    const times = d!.responses.map(r => r.submittedAt);
    expect([...times].sort().reverse()).toEqual(times);
    const [latest] = await db.$queryRaw<{id: string}[]>`SELECT id::text FROM responses WHERE contact_key = ${BIG} ORDER BY submitted_at DESC, id DESC LIMIT 1`;
    expect(d!.responses[0]!.id).toBe(latest!.id);
  });

  it('the overview, in one pass, matches plain counts', async () => {
    await clearContactsOverview();
    const o = await contactsOverview(db);
    const [s] = await db.$queryRaw<{total: number; returning: number; countries: number}[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE n >= 2)::int AS returning,
        count(DISTINCT country)::int AS countries FROM contacts`;
    expect(o.strip.total).toBe(Number(s!.total));
    expect(o.strip.returning).toBe(Number(s!.returning));
    expect(o.facets.countries).toHaveLength(Number(s!.countries));
    const [f0] = await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM contacts WHERE form_ids @> ARRAY[${forms[0]!.id}::uuid]`;
    expect(o.facets.forms.find(f => f.id === forms[0]!.id)?.contacts).toBe(Number(f0!.n));
    expect(o.facets.forms.some(f => f.id === forms[2]!.id)).toBe(false);
  });
});
