import {describe, expect, it} from 'vitest';

import {contactsCsvQuery, contactsListQuery, deleteContactsInput} from '../../src/lib/intelform/api-contacts';
import {contentDisposition, CSV_BOM, csvEscape, csvRow} from '../../src/server/intelform/responses/csv-text';
import {CSV_KEYS, LIST_KEYS, parseWith, rawQuery} from '../../src/server/intelform/contacts/input';
import {
  clearContactsOverview,
  contactDetail,
  contactsCsvBatch,
  contactsCsvFilename,
  contactsCsvHeader,
  contactsOverview,
  deleteContacts,
  listContacts,
  toRow,
} from '../../src/server/intelform/contacts/query';
import {
  afterFragment,
  dayRange,
  decodeContactCursor,
  encodeContactCursor,
  filterFragment,
  likePattern,
  orderFragment,
  searchPatterns,
} from '../../src/server/intelform/contacts/sql';
import {intlKnowsZone, safeTz, todayIn} from '../../src/server/intelform/contacts/tz';
import {Prisma} from '../../src/generated/prisma-node/client';

const FORM = '00000000-0000-4000-8000-00000000f001';

const listQ = (raw: Record<string, unknown> = {}) => contactsListQuery.parse(raw);

/** A fake Prisma client: answers each `$queryRaw` with the next canned result and records the SQL. */
function fakeDb(answers: unknown[][]) {
  const calls: {sql: string; values: unknown[]}[] = [];
  const queue = [...answers];
  const run = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const s = Prisma.sql(strings, ...values);
    calls.push({sql: s.sql, values: s.values});
    return queue.shift() ?? [];
  };
  const db = {
    $queryRaw: run,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const s = Prisma.sql(strings, ...values);
      calls.push({sql: s.sql, values: s.values});
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return {db: db as never, calls};
}

describe('contacts sql pieces', () => {
  it('escapes LIKE patterns', () => {
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });

  it('also searches a phone number without punctuation', () => {
    expect(searchPatterns('ada')).toEqual(['%ada%']);
    expect(searchPatterns('+44 (20) 7946-0')).toEqual(['%+44 (20) 7946-0%', '%+442079460%']);
    // Too short once compacted: only as typed.
    expect(searchPatterns('1 2')).toEqual(['%1 2%']);
  });

  it('builds no filter as `true`', () => {
    const f = filterFragment(listQ(), 'UTC');
    expect(f.sql.trim()).toBe('true');
    expect(f.values).toEqual([]);
  });

  it('binds every filter value as a parameter', () => {
    const q = listQ({
      q: "o'brien",
      segment: 'returning',
      form: [FORM],
      country: ['GB', 'FR'],
      has: ['phone', 'email', 'name'],
      from: '2026-01-01',
      to: '2026-01-31',
      min: '2',
      max: '9',
    });
    const f = filterFragment(q, 'Europe/London');
    expect(f.sql).not.toContain("o'brien");
    expect(f.values).toContain("%o'brien%");
    expect(f.values).toContainEqual([FORM]);
    expect(f.values).toContainEqual(['GB', 'FR']);
    expect(f.values).toContain('2026-01-01');
    expect(f.values).toContain('Europe/London');
    expect(f.values).toContain(2);
    expect(f.values).toContain(9);
    expect(f.sql).toContain('c.n >= 2');
    expect(f.sql).toContain('c.form_ids &&');
    expect(f.sql).toContain('c.phone IS NOT NULL');
    expect(f.sql).toContain('c.email IS NOT NULL');
    expect(f.sql).toContain('c.name IS NOT NULL');
    expect(f.sql).toContain('c.last_seen >=');
    expect(f.sql).toContain('c.last_seen <');
  });

  it('"new" means the date range, else the last 7 days', () => {
    expect(filterFragment(listQ({segment: 'new'}), 'UTC').sql).toContain("now() - interval '7 days'");
    const ranged = filterFragment(listQ({segment: 'new', from: '2026-03-01'}), 'UTC');
    expect(ranged.sql).toContain('c.first_seen >=');
    expect(ranged.sql).not.toContain('7 days');
  });

  it('builds a DST-safe day range', () => {
    const [from, to] = dayRange(Prisma.sql`x`, '2026-03-29', '2026-03-29', 'Europe/Berlin');
    expect(from!.sql).toContain('::date::timestamp AT TIME ZONE');
    expect(to!.sql).toContain('::date + 1)::timestamp AT TIME ZONE');
    expect(dayRange(Prisma.sql`x`, undefined, undefined, 'UTC')).toEqual([]);
  });

  it('orders from a fixed map (one index each), empty values last, then latest activity, then the key', () => {
    expect(orderFragment('name', 'asc').sql).toBe('(lower(c.name) IS NULL), lower(c.name) ASC, c.last_seen DESC, c.key ASC');
    expect(orderFragment('responses', 'desc').sql).toBe('c.n DESC, c.last_seen DESC, c.key ASC');
    // An unknown sort (can't pass the schema, but just in case) falls back to last activity.
    expect(orderFragment('nope' as never, 'desc').sql).toBe('c.last_seen DESC, c.key ASC');
    expect(orderFragment('email', 'asc').values).toEqual([]);
  });

  it('pages by keyset: after the cursor, empty values last', () => {
    const T = '2026-01-01T00:00:00.000Z';
    const after = afterFragment('last_seen', 'desc', {v: T, t: T, k: 'e:a@x.io'});
    expect(after.sql).toBe('(c.last_seen < ?::timestamptz OR (c.last_seen = ?::timestamptz AND c.key > ?))');
    expect(after.values).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'e:a@x.io']);
    const named = afterFragment('name', 'asc', {v: 'ada', t: T, k: 'e:a@x.io'});
    expect(named.sql).toContain('lower(c.name) IS NULL OR lower(c.name) >');
    expect(named.sql).toContain('c.last_seen < ?::timestamptz');
    expect(afterFragment('name', 'asc', {v: null, t: T, k: 'k'}).sql).toBe(
      '(lower(c.name) IS NULL AND (c.last_seen < ?::timestamptz OR (c.last_seen = ?::timestamptz AND c.key > ?)))'
    );
    // Names are any text: the cursor is UTF-8 safe.
    const cursor = {v: 'zoë 李', t: T, k: 'e:ada@example.com'};
    expect(decodeContactCursor(encodeContactCursor(cursor))).toEqual(cursor);
    expect(decodeContactCursor('not-json')).toBeNull();
    expect(decodeContactCursor(undefined)).toBeNull();
  });
});

describe('contacts query strings', () => {
  it('turns repeated keys into arrays and drops empty values', () => {
    const raw = rawQuery({form: FORM, country: ['GB', 'FR'], q: '', has: ['', 'phone'], cursor: 'abc', extra: 'x'}, LIST_KEYS);
    expect(raw).toEqual({form: [FORM], country: ['GB', 'FR'], has: ['phone'], cursor: 'abc'});
    const parsed = parseWith(contactsListQuery, raw);
    expect(parsed.ok && parsed.data).toMatchObject({form: [FORM], cursor: 'abc', sort: 'last_seen', dir: 'desc', segment: 'all'});
  });

  it('refuses inverted ranges and bad values with field messages', () => {
    const bad = parseWith(contactsListQuery, rawQuery({min: '3', max: '2'}, LIST_KEYS));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fields.min).toMatch(/at most/);
    const day = parseWith(contactsListQuery, rawQuery({from: '2026-02-30'}, LIST_KEYS));
    expect(day.ok).toBe(false);
    const sort = parseWith(contactsListQuery, rawQuery({sort: 'id; drop table'}, LIST_KEYS));
    expect(sort.ok).toBe(false);
  });

  it('accepts selected keys for the CSV, and refuses malformed ones', () => {
    const ok = parseWith(contactsCsvQuery, rawQuery({key: ['e:ada@example.com', 'p:+15555550123']}, CSV_KEYS));
    expect(ok.ok && ok.data.key).toEqual(['e:ada@example.com', 'p:+15555550123']);
    expect(parseWith(contactsCsvQuery, rawQuery({key: 'x:nope'}, CSV_KEYS)).ok).toBe(false);
  });

  it('needs 1 to 500 keys to delete', () => {
    expect(parseWith(deleteContactsInput, {keys: []}).ok).toBe(false);
    expect(parseWith(deleteContactsInput, {keys: Array.from({length: 501}, (_, i) => `e:p${i}@x.io`)}).ok).toBe(false);
    expect(parseWith(deleteContactsInput, {keys: ['e:ada@example.com']}).ok).toBe(true);
  });
});

describe('contacts csv', () => {
  it('quotes, escapes formulas and keeps numbers', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('+447700900111')).toBe("'+447700900111");
    expect(csvEscape(-3)).toBe('-3');
    expect(csvEscape(null)).toBe('');
    expect(csvRow(['a', 1, null])).toBe('a,1,\r\n');
  });

  it('names the download with an ASCII fallback', () => {
    expect(contactsCsvFilename('2026-11-16')).toBe('Contacts 2026-11-16.csv');
    expect(contentDisposition('Kontakte é.csv')).toBe(`attachment; filename="Kontakte _.csv"; filename*=UTF-8''Kontakte%20%C3%A9.csv`);
  });
});

describe('contacts time zones', () => {
  it('knows real zones only', () => {
    expect(intlKnowsZone('Europe/London')).toBe(true);
    expect(intlKnowsZone('Mars/Olympus')).toBe(false);
  });

  it('falls back to UTC without asking the database for bad input', async () => {
    const {db, calls} = fakeDb([]);
    expect(await safeTz(db, undefined)).toBe('UTC');
    expect(await safeTz(db, 'Mars/Olympus')).toBe('UTC');
    expect(calls).toHaveLength(0);
  });

  it('asks Postgres once per zone', async () => {
    const {db, calls} = fakeDb([[{ok: 1}]]);
    expect(await safeTz(db, 'Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(await safeTz(db, 'Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(['Asia/Dhaka']);
  });

  it("gives today's date in a zone", () => {
    const at = new Date('2026-11-16T22:30:00Z');
    expect(todayIn('UTC', at)).toBe('2026-11-16');
    expect(todayIn('Asia/Dhaka', at)).toBe('2026-11-17');
  });
});

const ada = {
  key: 'e:ada@example.com',
  n: 2,
  first_seen: new Date('2026-01-01T10:00:00Z'),
  last_seen: new Date('2026-11-01T10:00:00Z'),
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  phone: '+447700900111',
  country: 'FR',
  form_count: 4,
};

describe('contacts queries (fake database)', () => {
  it('shapes a row with at most 3 forms', () => {
    const forms = [1, 2, 3, 4].map(i => ({id: `f${i}`, title: `Form ${i}`, status: 'live' as const}));
    const row = toRow(ada, forms);
    expect(row).toMatchObject({key: 'e:ada@example.com', responseCount: 2, formCount: 4, firstSeen: '2026-01-01T10:00:00.000Z'});
    expect(row.forms.map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('lists one page from the contacts table by keyset, with each contact’s forms and no count', async () => {
    const many = Array.from({length: 51}, (_, i) => ({...ada, key: `e:p${i}@x.io`, sort_v: `p${i}`, sort_t: '2026-11-01T10:00:00.000Z'}));
    const {db, calls} = fakeDb([
      many,
      [
        {key: 'e:p0@x.io', id: 'f2', title: 'Event signup', status: 'live', responses: 1},
        {key: 'e:p0@x.io', id: 'f1', title: 'Survey', status: 'closed', responses: 1},
      ],
    ]);
    const res = await listContacts(db, listQ({sort: 'name', dir: 'asc'}), 'UTC');
    expect(res.contacts).toHaveLength(50);
    expect(res.contacts[0]!.forms.map(f => f.title)).toEqual(['Event signup', 'Survey']);
    expect(decodeContactCursor(res.nextCursor!)).toEqual({v: 'p49', t: '2026-11-01T10:00:00.000Z', k: 'e:p49@x.io'});
    expect(calls[0]!.sql).toContain('FROM contacts c');
    expect(calls[0]!.sql).not.toMatch(/count\(\*\) OVER|OFFSET|GROUP BY/);
    expect(calls[0]!.values.at(-1)).toBe(51);
    // The next page starts after that cursor.
    const next = fakeDb([[], []]);
    const last = await listContacts(next.db, listQ({sort: 'name', dir: 'asc', cursor: res.nextCursor}), 'UTC');
    expect(last.nextCursor).toBeNull();
    expect(next.calls[0]!.values).toContain('p49');
  });

  it('sums the strip and keeps the top 3 forms', async () => {
    await clearContactsOverview();
    const forms = [5, 4, 3, 2].map((n, i) => ({id: `f${i}`, title: `F${i}`, status: 'live', contacts: n}));
    const {db} = fakeDb([[{total: 3, new_week: 2, returning: 1, with_phone: 2}], [{code: 'US', contacts: 2}], forms]);
    const o = await contactsOverview(db);
    expect(o.strip).toMatchObject({total: 3, newThisWeek: 2, returning: 1, withPhonePct: 67});
    expect(o.strip.topForms).toHaveLength(3);
    expect(o.facets.forms).toHaveLength(4);
    expect(o.facets.countries).toEqual([{code: 'US', contacts: 2}]);
  });

  it('says 0% with a phone when there are no contacts', async () => {
    await clearContactsOverview();
    const {db} = fakeDb([[{total: 0, new_week: 0, returning: 0, with_phone: 0}], [], []]);
    expect((await contactsOverview(db)).strip.withPhonePct).toBe(0);
  });

  it('returns null for an unknown contact', async () => {
    const {db} = fakeDb([[], [], []]);
    expect(await contactDetail(db, 'e:nobody@example.com')).toBeNull();
  });

  it('shapes the detail', async () => {
    const {db} = fakeDb([
      [ada],
      [{key: ada.key, id: 'f1', title: 'Survey', status: 'live', responses: 2}],
      [
        {
          id: 'r1',
          submitted_at: new Date('2026-11-01T10:00:00Z'),
          duration_ms: 4000,
          device: 'mobile',
          country: 'FR',
          form_id: 'f1',
          title: 'Survey',
          status: 'live',
        },
      ],
    ]);
    const d = await contactDetail(db, ada.key);
    expect(d!.responses[0]).toEqual({
      id: 'r1',
      form: {id: 'f1', title: 'Survey', status: 'live'},
      submittedAt: '2026-11-01T10:00:00.000Z',
      durationMs: 4000,
      device: 'mobile',
      country: 'FR',
    });
    expect(d!.forms).toEqual([{id: 'f1', title: 'Survey', status: 'live', responses: 2}]);
  });

  it('deletes under form locks and fixes each form’s counts', async () => {
    const {db, calls} = fakeDb([
      [{form_id: 'f1'}, {form_id: 'f2'}],
      [{id: 'f1'}, {id: 'f2'}],
      [
        {form_id: 'f1', key: ada.key},
        {form_id: 'f2', key: ada.key},
        {form_id: 'f2', key: 'p:+15555550123'},
      ],
    ]);
    const res = await deleteContacts(db, [ada.key, ada.key, 'p:+15555550123', 'e:nobody@example.com']);
    // Signature files go to the file trash in the delete trigger, not through this code.
    expect(res).toEqual({contacts: 2, responses: 3});
    expect(calls[0]!.values[0]).toEqual([ada.key, 'p:+15555550123', 'e:nobody@example.com']);
    expect(calls[1]!.sql).toContain('FOR UPDATE');
    expect(calls[3]!.sql).toContain('UPDATE forms');
    expect(calls[3]!.values).toEqual([
      ['f1', 'f2'],
      [1, 2],
    ]);
  });

  it('deletes nothing for unknown contacts', async () => {
    const {db, calls} = fakeDb([[]]);
    expect(await deleteContacts(db, ['e:nobody@example.com'])).toEqual({contacts: 0, responses: 0});
    expect(calls).toHaveLength(1);
  });

  it('writes the CSV a batch at a time (the export job), BOM and header first, titles joined in one query', async () => {
    const row = {key: ada.key, sort_v: 'x', name: 'Ada', email: 'ada@example.com', phone: '+447700900111', country: 'FR', n: 2, forms: 'A; B', first_txt: '2026-01-01 10:00:00', last_txt: '2026-11-01 10:00:00'};
    const {db, calls} = fakeDb([[row]]);
    const q = contactsCsvQuery.parse({key: [ada.key]});
    expect(contactsCsvHeader()).toBe(`${CSV_BOM}Name,Email,Phone,Country,Responses,Forms,First seen,Last active\r\n`);
    const b = await contactsCsvBatch(db, q, 'UTC', null);
    expect(b.text).toBe("Ada,ada@example.com,'+447700900111,FR,2,A; B,2026-01-01 10:00:00,2026-11-01 10:00:00\r\n");
    expect(b.next).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toContainEqual([ada.key]);
    expect(calls[0]!.sql).not.toContain('OFFSET');
  });
});
