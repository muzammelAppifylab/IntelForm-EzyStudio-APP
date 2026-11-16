import {describe, expect, it} from 'vitest';

import {contactsCsvQuery, contactsListQuery, deleteContactsInput} from '../../src/lib/intelform/api-contacts';
import {contentDisposition, CSV_BOM, csvEscape, csvRow} from '../../src/server/intelform/contacts/csv';
import {CSV_KEYS, LIST_KEYS, parseWith, rawQuery} from '../../src/server/intelform/contacts/input';
import {
  contactDetail,
  contactsCsvChunks,
  contactsCsvFilename,
  contactsOverview,
  deleteContacts,
  listContacts,
  toRow,
} from '../../src/server/intelform/contacts/query';
import {
  contactsCte,
  dayRange,
  filterFragment,
  likePattern,
  orderFragment,
  platformFileId,
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

  it('orders from a fixed map, empty values last', () => {
    expect(orderFragment('name', 'asc').sql).toBe('lower(c.name) ASC NULLS LAST, c.last_seen DESC, c.key ASC');
    expect(orderFragment('responses', 'desc').sql).toBe('c.n DESC NULLS LAST, c.last_seen DESC, c.key ASC');
    // An unknown sort (can't pass the schema, but just in case) falls back to last activity.
    expect(orderFragment('nope' as never, 'desc').sql).toContain('c.last_seen DESC NULLS LAST');
    expect(orderFragment('email', 'asc').values).toEqual([]);
  });

  it('narrows the contacts CTE when asked', () => {
    const cte = contactsCte(Prisma.sql`contact_key = ${'e:a@example.com'}`);
    expect(cte.sql).toContain('GROUP BY contact_key');
    expect(cte.values).toEqual(['e:a@example.com']);
  });

  it('reads platform file ids out of signature URLs', () => {
    expect(platformFileId('/__platform/files/abc_123/signature.png')).toBe('abc_123');
    expect(platformFileId('https://evil.example/__platform/files/x/y')).toBeNull();
    expect(platformFileId('data:image/png;base64,AAA')).toBeNull();
    expect(platformFileId(null)).toBeNull();
  });
});

describe('contacts query strings', () => {
  it('turns repeated keys into arrays and drops empty values', () => {
    const raw = rawQuery({form: FORM, country: ['GB', 'FR'], q: '', has: ['', 'phone'], page: '2', extra: 'x'}, LIST_KEYS);
    expect(raw).toEqual({form: [FORM], country: ['GB', 'FR'], has: ['phone'], page: '2'});
    const parsed = parseWith(contactsListQuery, raw);
    expect(parsed.ok && parsed.data).toMatchObject({form: [FORM], page: 2, sort: 'last_seen', dir: 'desc', segment: 'all'});
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

  it('lists one page with the total and each contact’s forms', async () => {
    const {db, calls} = fakeDb([
      [{...ada, total: 51}],
      [
        {key: ada.key, id: 'f2', title: 'Event signup', status: 'live', responses: 1},
        {key: ada.key, id: 'f1', title: 'Survey', status: 'closed', responses: 1},
      ],
    ]);
    const res = await listContacts(db, listQ({page: '2', sort: 'name', dir: 'asc'}), 'UTC');
    expect(res).toMatchObject({total: 51, page: 2, pageSize: 50});
    expect(res.contacts[0]!.forms.map(f => f.title)).toEqual(['Event signup', 'Survey']);
    expect(calls[0]!.sql).toContain('LIMIT');
    expect(calls[0]!.values.slice(-2)).toEqual([50, 50]);
    expect(calls[0]!.sql).toContain('lower(c.name) ASC NULLS LAST');
  });

  it('counts separately past the last page', async () => {
    const {db, calls} = fakeDb([[], [{total: 7}]]);
    const res = await listContacts(db, listQ({page: '9'}), 'UTC');
    expect(res.total).toBe(7);
    expect(res.contacts).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('sums the strip and keeps the top 3 forms', async () => {
    const forms = [5, 4, 3, 2].map((n, i) => ({id: `f${i}`, title: `F${i}`, status: 'live', contacts: n}));
    const {db} = fakeDb([[{total: 3, new_week: 2, returning: 1, with_phone: 2}], [{code: 'US', contacts: 2}], forms]);
    const o = await contactsOverview(db);
    expect(o.strip).toMatchObject({total: 3, newThisWeek: 2, returning: 1, withPhonePct: 67});
    expect(o.strip.topForms).toHaveLength(3);
    expect(o.facets.forms).toHaveLength(4);
    expect(o.facets.countries).toEqual([{code: 'US', contacts: 2}]);
  });

  it('says 0% with a phone when there are no contacts', async () => {
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
        {form_id: 'f1', key: ada.key, urls: '/__platform/files/sig1/signature.png'},
        {form_id: 'f2', key: ada.key, urls: ''},
        {form_id: 'f2', key: 'p:+15555550123', urls: null},
      ],
    ]);
    const res = await deleteContacts(db, [ada.key, ada.key, 'p:+15555550123', 'e:nobody@example.com']);
    expect(res).toEqual({contacts: 2, responses: 3, fileIds: ['sig1']});
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
    expect(await deleteContacts(db, ['e:nobody@example.com'])).toEqual({contacts: 0, responses: 0, fileIds: []});
    expect(calls).toHaveLength(1);
  });

  it('streams the CSV in batches, BOM and header first', async () => {
    const row = {name: 'Ada', email: 'ada@example.com', phone: '+447700900111', country: 'FR', n: 2, forms: 'A; B', first_txt: '2026-01-01 10:00:00', last_txt: '2026-11-01 10:00:00'};
    const {db, calls} = fakeDb([[row]]);
    const q = contactsCsvQuery.parse({key: [ada.key]});
    const chunks: string[] = [];
    for await (const chunk of contactsCsvChunks(db, q, 'UTC')) chunks.push(chunk);
    expect(chunks[0]).toBe(`${CSV_BOM}Name,Email,Phone,Country,Responses,Forms,First seen,Last active\r\n`);
    expect(chunks[1]).toBe("Ada,ada@example.com,'+447700900111,FR,2,A; B,2026-01-01 10:00:00,2026-11-01 10:00:00\r\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toContainEqual([ada.key]);
  });

  it('stops streaming when the download is aborted', async () => {
    const {db, calls} = fakeDb([]);
    const q = contactsCsvQuery.parse({});
    const chunks: string[] = [];
    for await (const chunk of contactsCsvChunks(db, q, 'UTC', {aborted: () => true})) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});
