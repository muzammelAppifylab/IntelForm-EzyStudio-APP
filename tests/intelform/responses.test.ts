import {describe, expect, it} from 'vitest';

import type {SummaryQuery} from '../../src/lib/intelform/api-responses';
import {EMPTY_CATALOG, entriesOf, finishCatalog, foldVersions, parseField, type FormCatalog} from '../../src/server/intelform/responses/catalog';
/** The catalog of these versions, as the app builds it (stored form, then entries). */
const buildCatalog = (versions: Parameters<typeof foldVersions>[1], published: string | null) => {
  const folded = foldVersions(EMPTY_CATALOG, versions, published, null);
  return entriesOf(finishCatalog(folded.cat, folded.published));
};

import {csvFilename, dataRow, headerRow} from '../../src/server/intelform/responses/csv';
import {csvEscape, csvRow} from '../../src/server/intelform/responses/csv-text';
import {buildSearchText, displayAnswer, signatureLinkFor} from '../../src/server/intelform/responses/format';
import {
  addDays,
  containment,
  cursorFits,
  decodeCursor,
  encodeCursor,
  isFiltered,
  keysetFragments,
  likePattern,
  orderFragment,
  safeTz,
  sortSpec,
  todayIn,
  whereFragment,
} from '../../src/server/intelform/responses/query';
import {questionData, summaryRange, SummaryRangeError} from '../../src/server/intelform/responses/summary';
import {crc32, dosDateTime, entryName} from '../../src/server/intelform/responses/zip';

// ------------------------------------------------------------------ Fixture: two versions

const OPT = {a: 'o_aaaa01', b: 'o_bbbb01', c: 'o_cccc01'};
const Q = {
  choice: 'f_choice01',
  multi: 'f_multi001',
  yes: 'f_yesno001',
  nps: 'f_nps00001',
  rating: 'f_rating01',
  num: 'f_number01',
  text: 'f_text0001',
  gone: 'f_gone0001',
  name: 'f_name0001',
  sign: 'f_sign0001',
  country: 'f_country1',
};

function fields(version: 1 | 2) {
  const choiceOptions =
    version === 1
      ? [
          {id: OPT.a, label: 'Apple'},
          {id: OPT.b, label: 'Banana'},
          {id: OPT.c, label: 'Cherry'},
        ]
      : [
          {id: OPT.a, label: 'Apple'},
          {id: OPT.b, label: 'Blueberry'},
        ];
  return [
    {id: Q.name, type: 'name', label: 'Your name', props: {split: true}},
    {id: 'f_sect0001', type: 'section_break', label: 'About you'},
    {
      id: Q.choice,
      type: 'single_choice',
      label: 'Favourite fruit',
      props: {options: choiceOptions, other: true},
    },
    {
      id: Q.multi,
      type: 'multiple_choice',
      label: 'Toppings',
      props: {
        options: [
          {id: 'o_xxxx01', label: 'X'},
          {id: 'o_yyyy01', label: 'Y'},
        ],
      },
    },
    {id: Q.yes, type: 'yes_no', label: 'Would you return?', props: {}},
    {id: Q.nps, type: 'nps', label: 'Recommend us?', props: {}},
    {id: Q.rating, type: 'rating', label: 'Rate us', props: {scale: 5}},
    {id: Q.num, type: 'number', label: 'How many?', props: {}},
    {id: Q.country, type: 'country', label: 'Country', props: {}},
    {id: Q.sign, type: 'signature', label: 'Sign here', props: {}},
    {
      id: Q.text,
      type: 'short_text',
      label: version === 1 ? 'Old label' : 'New label',
      props: {},
    },
    ...(version === 1
      ? [
          {
            id: Q.gone,
            type: 'short_text',
            label: 'Removed question',
            props: {},
          },
        ]
      : []),
  ];
}

const FORM_ID = '00000000-0000-4000-8000-0000000000aa';

function catalog(): FormCatalog {
  const built = buildCatalog(
    [
      {id: 'v2', version: 2, fields: fields(2)},
      {id: 'v1', version: 1, fields: fields(1)},
    ],
    'v2'
  );
  return {
    form: {
      id: FORM_ID,
      title: 'Feedback',
      slug: 'feedback',
      publishedVersionId: 'v2',
      responseCount: 12,
    },
    ...built,
  };
}

const field = (id: string) => catalog().byId.get(id)!;
const SIG_ID = 'file_0123456789abcdefghijklmnop';
const SIG = `/__platform/files/${SIG_ID}/signature.png`;

// ------------------------------------------------------------------ Catalog

describe('catalog', () => {
  it('lists current fields in order, then deleted ones, without section breaks', () => {
    const cat = catalog();
    const ids = cat.entries.map(e => e.meta.id);
    expect(ids).toEqual([Q.name, Q.choice, Q.multi, Q.yes, Q.nps, Q.rating, Q.num, Q.country, Q.sign, Q.text, Q.gone]);
    expect(cat.byId.get(Q.text)!.meta.label).toBe('New label');
    expect(cat.byId.get(Q.gone)!.meta).toMatchObject({
      label: 'Removed question (deleted)',
      deleted: true,
    });
  });

  it('keeps removed options, marked deleted, and adds Other and yes / no', () => {
    const choice = field(Q.choice).meta;
    expect(choice.options).toEqual([
      {id: OPT.a, label: 'Apple', deleted: false},
      {id: OPT.b, label: 'Blueberry', deleted: false},
      {id: OPT.c, label: 'Cherry (deleted option)', deleted: true},
      {id: 'o_other', label: 'Other', deleted: false},
    ]);
    expect(choice.filterable).toBe(true);
    expect(field(Q.yes).meta.options?.map(o => o.id)).toEqual(['true', 'false']);
    expect(field(Q.text).meta.filterable).toBe(false);
    // CSV uses plain labels, the table "(deleted option)".
    expect(displayAnswer(field(Q.choice).display, {option: OPT.c}).text).toBe('Cherry (deleted option)');
    expect(displayAnswer(field(Q.choice).plain, {option: OPT.c}).text).toBe('Cherry');
  });

  it('parses junk fields leniently or drops them', () => {
    expect(parseField(null)).toBeNull();
    expect(parseField({id: 'f_x', type: 'nope'})).toBeNull();
    const f = parseField({
      id: 'f_abcd01',
      type: 'short_text',
      label: 7,
      props: {unknownProp: 1},
    });
    expect(f?.type).toBe('short_text');
    expect(buildCatalog([], null).entries).toEqual([]);
  });
});

// ------------------------------------------------------------------ Formatting

describe('answers', () => {
  it('links only files this site stored, through the guarded view route', () => {
    const sign = field(Q.sign).display;
    const view = `/site-api/uploads/signatures/r1/${Q.sign}`;
    // Stored as a private {fileId}; older answers as a {url} of a file this site stored.
    expect(displayAnswer(sign, {fileId: SIG_ID}, 'r1')).toEqual({text: 'Signed', url: view});
    expect(displayAnswer(sign, {url: SIG}, 'r1')).toEqual({text: 'Signed', url: view});
    // Without a response id there is nothing to link: just "Signed", never the file.
    expect(displayAnswer(sign, {fileId: SIG_ID})).toEqual({text: 'Signed'});
    expect(signatureLinkFor({url: SIG}, 'r1', Q.sign)).toBe(view);
    for (const url of [
      'https://tracker.example/pixel.png',
      '/__platform/files/../x.png',
      'javascript:alert(1)',
      'data:image/png;base64,AA',
    ]) {
      expect(displayAnswer(sign, {url}, 'r1').url, url).toBeUndefined();
    }
    // A text answer kept when the field's type changed to signature with the same id.
    expect(displayAnswer(sign, 'hello')).toEqual({text: 'hello'});
  });

  it('formats every kind of answer as text', () => {
    expect(displayAnswer(field(Q.name).display, {first: 'Ada', last: 'Lovelace'}).text).toBe('Ada Lovelace');
    expect(displayAnswer(field(Q.multi).display, [{option: 'o_xxxx01'}, {option: 'o_yyyy01'}]).text).toBe('X; Y');
    expect(displayAnswer(field(Q.country).display, 'DE').text).toBe('Germany');
    expect(displayAnswer(field(Q.nps).display, 9).text).toBe('9');
    expect(displayAnswer(field(Q.text).display, undefined).text).toBe('');
  });

  it('builds the search text from text answers and Other text', () => {
    const fs = catalog().entries.map(e => e.plain);
    const text = buildSearchText(fs, {
      [Q.name]: {first: 'Ada', last: 'Lovelace'},
      [Q.text]: 'hello',
      [Q.choice]: {option: 'o_other', other: 'Kiwi'},
      [Q.nps]: 10,
    });
    expect(text.split('\n')).toEqual(['Ada Lovelace', 'Kiwi', 'hello']);
  });
});

// ------------------------------------------------------------------ CSV

describe('csv', () => {
  it('escapes formulas, quotes and keeps numbers', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('-5')).toBe("'-5");
    expect(csvEscape(-5)).toBe('-5');
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(Number.NaN)).toBe('');
    expect(csvRow(['a', 1, true])).toBe('a,1,true\r\n');
  });

  it('names the download safely', () => {
    expect(csvFilename({title: 'a/b:c', slug: 's'}, '2026-01-02')).toBe('a b c responses 2026-01-02.csv');
    expect(csvFilename({title: '', slug: ''}, '2026-01-02')).toBe('responses responses 2026-01-02.csv');
  });

  it('writes one column per field part, deleted ones marked, then the meta columns', () => {
    const cat = catalog();
    const header = headerRow(cat);
    expect(header.startsWith('Your name (first name),Your name (last name),Favourite fruit,')).toBe(true);
    expect(header).toContain('Removed question (deleted)');
    expect(header.endsWith('Submitted at,Completion time (seconds),Device,Browser,Country,Response ID\r\n')).toBe(true);
    const row = dataRow(
      cat,
      {
      id: 'r1',
      submitted: '2026-01-02 03:04:05',
      duration_ms: 12_345,
      device: 'desktop',
      browser: 'Firefox',
      country: 'DE',
      answers: {
        [Q.name]: {first: 'Ada', last: 'Lovelace'},
        [Q.choice]: {option: OPT.c},
        [Q.sign]: {fileId: SIG_ID},
        [Q.gone]: '=1+1',
      },
      },
      'https://forms.example.com'
    );
    const cells = row.trimEnd().split(',');
    expect(cells.slice(0, 3)).toEqual(['Ada', 'Lovelace', 'Cherry']);
    // The signature cell is the dashboard's guarded link (a sign-in opens it), never the file.
    expect(row).toContain(`https://forms.example.com/site-api/uploads/signatures/r1/${Q.sign}`);
    expect(row).not.toContain('__platform');
    expect(row).toContain("'=1+1");
    expect(row.endsWith('2026-01-02 03:04:05,12.3,desktop,Firefox,DE,r1\r\n')).toBe(true);
    // Same number of cells in the header and a row.
    expect(header.split(',').length).toBe(row.split(',').length);
  });
});

// ------------------------------------------------------------------ SQL pieces

describe('query pieces', () => {
  const base = {
    filter: [] as string[],
    sort: 'submitted_at',
    dir: 'desc' as const,
  };

  it('falls back to UTC for unknown time zones', () => {
    expect(safeTz('Europe/Berlin')).toBe('Europe/Berlin');
    expect(safeTz('Mars/Olympus')).toBe('UTC');
    expect(safeTz(undefined)).toBe('UTC');
    expect(todayIn('UTC', new Date('2026-03-04T23:30:00Z'))).toBe('2026-03-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('turns filters into containment checks, OR within a field and AND across', () => {
    const cat = catalog();
    expect(containment(cat, Q.choice, OPT.a)).toEqual({
      [Q.choice]: {option: OPT.a},
    });
    expect(containment(cat, Q.multi, 'o_xxxx01')).toEqual({
      [Q.multi]: [{option: 'o_xxxx01'}],
    });
    expect(containment(cat, Q.yes, 'true')).toEqual({[Q.yes]: true});
    expect(containment(cat, Q.yes, 'maybe')).toBeNull();
    expect(containment(cat, Q.nps, '10')).toEqual({[Q.nps]: 10});
    expect(containment(cat, Q.text, 'x')).toBeNull();
    const w = whereFragment(
      cat,
      {
        ...base,
        q: '50%_off',
        filter: [`${Q.choice}:${OPT.a}`, `${Q.choice}:${OPT.b}`, `${Q.yes}:true`],
      },
      'UTC'
    );
    expect(w.sql).toContain('search_text ILIKE');
    expect(w.sql.match(/answers @>/g)?.length).toBe(3);
    expect(w.sql).toContain('(answers @> ?::jsonb OR answers @> ?::jsonb) AND (answers @> ?::jsonb)');
    expect(w.values).toContain(FORM_ID);
    expect(w.values).toContain('%50\\%\\_off%');
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
    expect(isFiltered({...base})).toBe(false);
    expect(isFiltered({...base, has: Q.text})).toBe(true);
  });

  it('never puts user input into the SQL text', () => {
    const cat = catalog();
    const evil = "x'); DROP TABLE responses; --";
    const w = whereFragment(
      cat,
      {
        ...base,
        q: evil,
        has: evil,
        from: '2026-01-01',
        to: '2026-01-31',
        tz: evil,
      },
      'UTC'
    );
    expect(w.sql).not.toContain('DROP');
    // An unknown sort column sorts by submitted_at.
    const s = sortSpec(cat, evil, 'asc');
    expect(s.notNull).toBe(true);
    expect(orderFragment(s).sql).toBe('submitted_at ASC, id ASC');
  });

  it('sorts per type with unanswered last', () => {
    const cat = catalog();
    expect(sortSpec(cat, 'submitted_at', 'desc')).toMatchObject({
      type: 'timestamptz',
      notNull: true,
      tie: 'desc',
    });
    const nps = sortSpec(cat, Q.nps, 'asc');
    expect(nps).toMatchObject({type: 'numeric', notNull: false, tie: 'desc'});
    expect(orderFragment(nps).sql).toContain('NULLS LAST');
    const choice = sortSpec(cat, Q.choice, 'asc');
    expect(choice.type).toBe('int');
    // Options pre-sorted by label: Apple, Blueberry, Cherry (deleted option), Other.
    expect(choice.expr.values[0]).toEqual([OPT.a, OPT.b, OPT.c, 'o_other']);
    expect(sortSpec(cat, 'duration', 'desc').type).toBe('int');
    expect(sortSpec(cat, Q.yes, 'desc').type).toBe('boolean');
    const k = keysetFragments(sortSpec(cat, 'submitted_at', 'desc'));
    // A row comparison, so the (form_id, submitted_at DESC, id DESC) index starts at the cursor.
    expect(k.after.sql).toBe('(submitted_at, id) < (cur.k, cur.kid)');
    expect(k.before.sql).toBe('(submitted_at, id) > (cur.k, cur.kid)');
    const asc = keysetFragments(sortSpec(cat, 'submitted_at', 'asc'));
    expect(asc.after.sql).toBe('(submitted_at, id) > (cur.k, cur.kid)');
    expect(keysetFragments(nps).after.sql).toContain('CASE WHEN cur.k IS NULL');
  });

  it('round-trips keyset cursors and refuses forged ones', () => {
    const c = {
      k: '2026-01-02 03:04:05.123+00',
      id: '00000000-0000-4000-8000-000000000001',
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({k: null, id: c.id}))).toEqual({
      k: null,
      id: c.id,
    });
    expect(decodeCursor('not base64!')).toBeNull();
    expect(decodeCursor(encodeCursor({k: 'x', id: 'not-a-uuid'}))).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(cursorFits(c, 'timestamptz')).toBe(true);
    expect(cursorFits({k: 'yesterday', id: c.id}, 'timestamptz')).toBe(false);
    expect(cursorFits({k: '12', id: c.id}, 'int')).toBe(true);
    expect(cursorFits({k: '1.5', id: c.id}, 'int')).toBe(false);
    expect(cursorFits({k: '-1.25', id: c.id}, 'numeric')).toBe(true);
    expect(cursorFits({k: 'true', id: c.id}, 'boolean')).toBe(true);
    expect(cursorFits({k: 'yes', id: c.id}, 'boolean')).toBe(false);
  });
});

// ------------------------------------------------------------------ Summary

describe('summary', () => {
  const day = new Date('2026-01-02T00:00:00Z');

  it('works out the date range', () => {
    const q = (v: Partial<SummaryQuery>) => ({range: '30d', ...v}) as SummaryQuery;
    expect(summaryRange(q({range: '7d'}), '2026-01-10', null)).toEqual({
      from: '2026-01-04',
      to: '2026-01-10',
    });
    expect(summaryRange(q({range: 'all'}), '2026-01-10', '2025-12-01')).toEqual({from: '2025-12-01', to: '2026-01-10'});
    expect(summaryRange(q({range: 'all'}), '2026-01-10', null)).toEqual({
      from: '2026-01-04',
      to: '2026-01-10',
    });
    expect(summaryRange(q({range: 'custom', from: '2026-01-01', to: '2026-01-05'}), '2026-01-10', null)).toEqual({
      from: '2026-01-01',
      to: '2026-01-05',
    });
    expect(() => summaryRange(q({range: 'custom', from: '2000-01-01', to: '2026-01-05'}), '2026-01-10', null)).toThrow(SummaryRangeError);
  });

  it('counts choices with percentages, deleted options only while answered', () => {
    const counts = new Map([
      [OPT.a, 3],
      [OPT.c, 1],
      ['o_other', 1],
    ]);
    const data = questionData(
      field(Q.choice),
      5,
      counts,
      undefined,
      [],
      [
        {
          id: 'r1',
          submitted_at: day,
          val: {option: 'o_other', other: 'Kiwi'},
        },
        {id: 'r2', submitted_at: day, val: {option: 'o_other', other: ''}},
      ]
    );
    expect(data).toEqual({
      kind: 'choice',
      options: [
        {id: OPT.a, label: 'Apple', count: 3, pct: 60},
        {id: OPT.b, label: 'Blueberry', count: 0, pct: 0},
        {
          id: OPT.c,
          label: 'Cherry (deleted option)',
          count: 1,
          pct: 20,
          deleted: true,
        },
        {id: 'o_other', label: 'Other', count: 1, pct: 20, other: true},
      ],
      other: [{responseId: 'r1', submittedAt: day.toISOString(), text: 'Kiwi'}],
    });
    const none = questionData(field(Q.choice), 0, new Map(), undefined, [], []);
    expect(none.kind === 'choice' && none.options.some(o => o.id === OPT.c)).toBe(false);
  });

  it('scores NPS and ratings', () => {
    const nps = questionData(
      field(Q.nps),
      10,
      new Map([
        ['10', 5],
        ['8', 2],
        ['3', 3],
      ]),
      undefined,
      [],
      []
    );
    expect(nps).toMatchObject({
      kind: 'nps',
      score: 20,
      detractors: 3,
      passives: 2,
      promoters: 5,
    });
    const rating = questionData(
      field(Q.rating),
      4,
      new Map([
        ['5', 2],
        ['4', 1],
        ['1', 1],
      ]),
      {n: 4, avg: 3.75, min: 1, max: 5, median: 4.5},
      [],
      []
    );
    expect(rating).toMatchObject({
      kind: 'rating',
      scale: 5,
      average: 3.8,
      csat: 75,
    });
    const number = questionData(field(Q.num), 2, new Map(), {n: 2, avg: 1.25, min: 1, max: 1.5, median: 1.25}, [], []);
    expect(number).toEqual({
      kind: 'number',
      average: 1.3,
      min: 1,
      max: 1.5,
      median: 1.3,
    });
    expect(questionData(field(Q.sign), 3, new Map(), undefined, [], [])).toEqual({kind: 'count', count: 3, noun: 'signed'});
    const country = questionData(
      field(Q.country),
      3,
      new Map([
        ['FR', 1],
        ['DE', 2],
      ]),
      undefined,
      [],
      []
    );
    expect(country.kind === 'choice' && country.options.map(o => o.label)).toEqual(['Germany', 'France']);
    const latest = questionData(field(Q.text), 1, new Map(), undefined, [{id: 'r1', submitted_at: day, val: 'Hi'}], []);
    expect(latest).toEqual({
      kind: 'latest',
      items: [{responseId: 'r1', submittedAt: day.toISOString(), text: 'Hi'}],
    });
  });
});

// ------------------------------------------------------------------ ZIP

describe('zip', () => {
  it('computes CRC-32 and DOS dates', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const a = new TextEncoder().encode('1234');
    expect(crc32(new TextEncoder().encode('56789'), crc32(a))).toBe(0xcbf43926);
    expect(dosDateTime(new Date('2026-11-16T10:20:31Z'))).toEqual({
      time: (10 << 11) | (20 << 5) | 15,
      date: (46 << 9) | (11 << 5) | 16,
    });
  });

  it('names entries uniquely', () => {
    const used = new Set<string>();
    expect(entryName({id: 'x', slug: 'contact-us'}, used)).toBe('contact-us.csv');
    expect(entryName({id: 'x', slug: 'contact-us'}, used)).toBe('contact-us-2.csv');
    expect(entryName({id: 'abc', slug: ''}, used)).toBe('abc.csv');
  });
});
