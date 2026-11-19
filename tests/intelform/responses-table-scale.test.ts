import {describe, expect, it} from 'vitest';

import {responsesCsvQuery, responsesFilterQuery, responsesListQuery, searchTerm} from '../../src/lib/intelform/api-responses';
import {Prisma} from '../../src/generated/prisma-node/client';
import {EMPTY_CATALOG, entriesOf, finishCatalog, foldVersions, type FormCatalog} from '../../src/server/intelform/responses/catalog';
/** The catalog of these versions, as the app builds it (stored form, then entries). */
const buildCatalog = (versions: Parameters<typeof foldVersions>[1], published: string | null) => {
  const folded = foldVersions(EMPTY_CATALOG, versions, published, null);
  return entriesOf(finishCatalog(folded.cat, folded.published));
};

import {
  ANSWER_SORT_WINDOW,
  pageQuery,
  scanWindow,
  SEARCH_WINDOW,
  sortSpec,
  tableWhere,
  windowFragment,
} from '../../src/server/intelform/responses/query';
import {answersSelect, MAX_PAGE_COLUMNS, pageFieldIds, rowCells} from '../../src/server/intelform/responses/table';

/**
 * The Responses table's limits for big forms, as SQL shapes (no database): the has / search
 * window, the two-part keyset for the indexed metadata sorts, visible columns only.
 * The same queries against Postgres, with their plans: tests/integration/responses-scale.test.ts.
 */

const FORM_ID = '00000000-0000-4000-8000-0000000000aa';
const ID = '00000000-0000-4000-8000-000000000001';

function catalog(responseCount: number): FormCatalog {
  const fields = [
    {id: 'f_text0001', type: 'short_text', label: 'Text', props: {}},
    {id: 'f_nps00001', type: 'nps', label: 'NPS', props: {}},
    {id: 'f_sign0001', type: 'signature', label: 'Sign', props: {}},
  ];
  return {
    form: {id: FORM_ID, title: 'F', slug: 'f', publishedVersionId: 'v1', responseCount},
    ...buildCatalog([{id: 'v1', version: 1, fields}], 'v1'),
  };
}

const filters = (v: Record<string, unknown> = {}) => responsesFilterQuery.parse(v);
const flat = (s: Prisma.Sql) => s.sql.replace(/\s+/g, ' ');

describe('search terms', () => {
  it('needs three characters (trimmed), says how to fix it, and the CSV job still takes any', () => {
    expect(responsesFilterQuery.safeParse({q: 'ab'}).success).toBe(false);
    const bad = responsesFilterQuery.safeParse({q: ' ab '});
    expect(bad.error?.issues[0]?.message).toBe('Type at least 3 characters to search.');
    expect(responsesFilterQuery.parse({q: ' abc '}).q).toBe('abc');
    expect(responsesFilterQuery.parse({q: ''}).q).toBe('');
    expect(responsesCsvQuery.parse({q: 'a'}).q).toBe('a');
    expect(searchTerm(' ab ')).toBe('');
    expect(searchTerm(' abc ')).toBe('abc');
  });

  it('takes at most 100 visible columns', () => {
    const col = Array.from({length: 101}, (_, i) => `f_c${String(i).padStart(4, '0')}`);
    expect(responsesListQuery.safeParse({col}).success).toBe(false);
    expect(responsesListQuery.parse({col: col.slice(0, 100)}).col).toHaveLength(100);
    expect(responsesListQuery.safeParse({col: ['answers; DROP']}).success).toBe(false);
    expect(responsesListQuery.parse({}).col).toEqual([]);
  });
});

describe('scan window', () => {
  it('bounds has / search past SEARCH_WINDOW and answer sorts past ANSWER_SORT_WINDOW; never otherwise', () => {
    const small = catalog(SEARCH_WINDOW);
    expect(scanWindow(small, filters({has: 'f_text0001'}))).toBeNull();
    const big = catalog(1_000_000);
    expect(scanWindow(big, filters({has: 'f_text0001'}))).toEqual({size: SEARCH_WINDOW, reason: 'search'});
    expect(scanWindow(big, filters({q: 'abc'}))).toEqual({size: SEARCH_WINDOW, reason: 'search'});
    expect(scanWindow(big, filters({q: 'abc', sort: 'f_nps00001'}))).toEqual({size: ANSWER_SORT_WINDOW, reason: 'sort'});
    expect(scanWindow(catalog(ANSWER_SORT_WINDOW + 1), filters({sort: 'f_nps00001'}))).toEqual({size: ANSWER_SORT_WINDOW, reason: 'sort'});
    // Date ranges, choice filters and the indexed sort (submitted_at) never need it.
    expect(scanWindow(big, filters({sort: 'submitted_at', from: '2026-01-01'}))).toBeNull();
    // The metadata sorts have no index of their own (every submit would pay for it): the window.
    for (const sort of ['duration', 'device', 'browser', 'country']) {
      expect(scanWindow(big, filters({sort}))).toEqual({size: ANSWER_SORT_WINDOW, reason: 'sort'});
      expect(scanWindow(catalog(ANSWER_SORT_WINDOW), filters({sort}))).toBeNull();
    }
    expect(scanWindow(big, filters({filter: ['f_nps00001:9']}))).toBeNull();
  });

  it('is a row comparison against the n-th newest row, bound as parameters', () => {
    const w = windowFragment(FORM_ID, 100_000);
    expect(flat(w)).toContain('(submitted_at, id) >= (SELECT coalesce(b.s');
    expect(flat(w)).toContain('ORDER BY submitted_at DESC, id DESC OFFSET ? LIMIT 1');
    expect(w.values).toContain(99_999);
    expect(w.values).toContain(FORM_ID);
    const {where, window} = tableWhere(catalog(1_000_000), filters({has: 'f_text0001'}), 'UTC');
    expect(window?.size).toBe(SEARCH_WINDOW);
    expect(flat(where)).toContain('answers ? ? AND (submitted_at, id) >=');
    expect(flat(tableWhere(catalog(10), filters({has: 'f_text0001'}), 'UTC').where)).not.toContain('(submitted_at, id) >=');
  });
});

describe('keyset pages', () => {
  const cat = catalog(10);
  const where = Prisma.sql`form_id = ${FORM_ID}::uuid`;
  const cols = Prisma.sql`id`;

  it('sorts the metadata columns like answers: NULLS LAST, the CASE keyset, no index of their own', () => {
    for (const sort of ['duration', 'device', 'browser', 'country']) {
      expect(sortSpec(cat, sort, 'asc')).toMatchObject({notNull: false, tie: 'asc'});
      expect(sortSpec(cat, sort, 'desc')).toMatchObject({notNull: false, tie: 'desc'});
    }
    const s = sortSpec(cat, 'duration', 'desc');
    const first = flat(pageQuery(s, where, cols, {kind: 'first'}, 51));
    expect(first).toContain('ORDER BY duration_ms DESC NULLS LAST, id DESC LIMIT ?');
    expect(first).not.toContain('UNION');
    const after = flat(pageQuery(s, where, cols, {kind: 'after', cur: {k: '10', id: ID}}, 51));
    expect(after).toContain('WITH cur AS (SELECT ?::int AS k');
    expect(after).toContain('CASE WHEN cur.k IS NULL');
    const before = flat(pageQuery(s, where, cols, {kind: 'before', cur: {k: '10', id: ID}}, 51));
    expect(before).toContain('ORDER BY duration_ms ASC NULLS FIRST, id ASC');
  });

  it('keeps the row comparison for submitted_at and the CASE keyset for answers', () => {
    const s = flat(pageQuery(sortSpec(cat, 'submitted_at', 'desc'), where, cols, {kind: 'after', cur: {k: '2026-01-01 00:00:00+00', id: ID}}, 51));
    expect(s).toContain('(submitted_at, id) < (cur.k, cur.kid)');
    expect(s).not.toContain('UNION');
    const a = flat(pageQuery(sortSpec(cat, 'f_nps00001', 'asc'), where, cols, {kind: 'after', cur: {k: '3', id: ID}}, 51));
    expect(a).toContain('CASE WHEN cur.k IS NULL');
    expect(a).toContain('NULLS LAST');
  });
});

describe('visible columns', () => {
  const cat = catalog(10);

  it('reads and sends only the visible fields’ answers', () => {
    expect(pageFieldIds(cat, [])).toBeNull();
    expect(pageFieldIds(cat, ['submitted_at', 'duration'])).toEqual([]);
    expect(pageFieldIds(cat, ['f_nps00001', 'f_unknown1', 'f_nps00001', 'f_text0001'])).toEqual(['f_nps00001', 'f_text0001']);
    expect(answersSelect(null).sql).toBe('answers');
    expect(answersSelect([]).sql).toBe(`'{}'::jsonb AS answers`);
    const some = answersSelect(['f_nps00001']);
    expect(flat(some)).toContain('jsonb_each(answers) a WHERE a.key = ANY(?::text[])');
    expect(some.values).toEqual([['f_nps00001']]);
    expect(MAX_PAGE_COLUMNS).toBe(100);
    const answers = {f_text0001: 'hello', f_nps00001: 9};
    expect(rowCells(cat, answers, ID, new Set(['f_nps00001'])).cells).toEqual({f_nps00001: '9'});
    expect(Object.keys(rowCells(cat, answers, ID).cells).sort()).toEqual(['f_nps00001', 'f_text0001']);
  });
});
