import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {responsesFilterQuery} from '../../src/lib/intelform/api-responses';
// The Node build of the client, as the vitest alias maps the app's own import.
import {Prisma} from '../../src/generated/prisma-node/client';
import {loadCatalog, type FormCatalog} from '../../src/server/intelform/responses/catalog';
import {
  decodeCursor,
  pageQuery,
  safeTz,
  sortSpec,
  tableWhere,
  whereFragment,
  windowFragment,
  type PageFrom,
} from '../../src/server/intelform/responses/query';
import {listResponses, responseDetail} from '../../src/server/intelform/responses/table';
import {DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The Responses table at scale, against a real Postgres: a 20,000-response form for the query
 * plans (the per-column sort indexes, the has / search window on the submitted_at index) and a
 * 300-response form walked page by page in every metadata sort, both ways, against a plain
 * ORDER BY. Runs only with TEST_DATABASE_URL.
 */

const BIG = '00000000-0000-4000-8000-0000000000c1';
const SMALL = '00000000-0000-4000-8000-0000000000c2';
const sql = Prisma.sql;

const fields = [
  {id: 'f_text0001', type: 'short_text', label: 'Answer', required: false, props: {}},
  {id: 'f_rare0001', type: 'short_text', label: 'Rarely answered', required: false, props: {}},
  {id: 'f_num00001', type: 'number', label: 'A number', required: false, props: {}},
];
const definition = {
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks!', message: ''},
  fields: [
    ...fields.slice(0, 1).map(f => ({...f, description: 'x'.repeat(5000), descriptionFormat: undefined})),
    {id: 'f_sect0001', type: 'section_break', label: 'Part two', required: false, props: {}},
    ...fields.slice(1),
  ],
};

/**
 * `n` responses: every 7th without a duration, every 5th without a device, every 3rd without a
 * browser, every 4th without a country; pairs share a submitted_at (ties); every 997th answers
 * the rare question; every 1,000th says "needle".
 */
async function insertForm(id: string, slug: string, n: number) {
  const versionId = id.replace(/c(\d)$/, 'd$1');
  const def = JSON.stringify(definition);
  await db.$executeRaw`
    INSERT INTO forms (id, slug, title, status, draft, response_count, last_response_at)
    VALUES (${id}::uuid, ${slug}, ${'Scale ' + slug}, 'live', ${def}::jsonb, ${n}, now())`;
  await db.$executeRaw`
    INSERT INTO form_versions (id, form_id, version, definition, theme) VALUES (${versionId}::uuid, ${id}::uuid, 1, ${def}::jsonb, '{}'::jsonb)`;
  await db.$executeRaw`UPDATE forms SET published_version_id = ${versionId}::uuid WHERE id = ${id}::uuid`;
  await db.$executeRaw`
    INSERT INTO responses (id, form_id, form_version_id, answers, submitted_at, duration_ms, device, browser, country, search_text)
    SELECT gen_random_uuid(), ${id}::uuid, ${versionId}::uuid,
      jsonb_build_object('f_text0001', 'answer ' || g, 'f_num00001', g % 50)
        || CASE WHEN g % 997 = 0 THEN jsonb_build_object('f_rare0001', 'rare') ELSE '{}'::jsonb END,
      timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g / 2),
      CASE WHEN g % 7 = 0 THEN NULL ELSE (g * 37) % 500 END,
      CASE WHEN g % 5 = 0 THEN NULL ELSE (ARRAY['desktop', 'mobile', 'tablet'])[1 + g % 3] END,
      CASE WHEN g % 3 = 0 THEN NULL ELSE (ARRAY['Chrome', 'Firefox', 'Safari', 'Edge'])[1 + g % 4] END,
      CASE WHEN g % 4 = 0 THEN NULL ELSE (ARRAY['DE', 'US', 'FR'])[1 + g % 3] END,
      'answer ' || g || CASE WHEN g % 1000 = 0 THEN ' needle' ELSE '' END
    FROM generate_series(1, ${n}::int) g`;
}

const filters = (v: Record<string, unknown> = {}) => responsesFilterQuery.parse(v);
const META: Record<string, string> = {duration: 'duration_ms', device: 'device', browser: 'browser', country: 'country'};

async function plan(q: Prisma.Sql): Promise<string> {
  const rows = await db.$queryRaw<{'QUERY PLAN': string}[]>(sql`EXPLAIN ${q}`);
  return rows.map(r => r['QUERY PLAN']).join('\n');
}

describe.skipIf(!DATABASE_URL)('responses table at scale (integration, real Postgres)', () => {
  let big: FormCatalog;
  let small: FormCatalog;

  beforeAll(async () => {
    await resetDatabase();
    await insertForm(BIG, 'big', 20_000);
    await insertForm(SMALL, 'small', 300);
    await db.$executeRawUnsafe('ANALYZE responses');
    big = (await loadCatalog(db, BIG))!;
    small = (await loadCatalog(db, SMALL))!;
  }, 120_000);
  afterAll(() => db.$disconnect());

  it('pages every metadata sort, both ways, forwards and backwards, like ORDER BY … NULLS LAST', async () => {
    for (const [sort, column] of Object.entries(META)) {
      for (const dir of ['asc', 'desc'] as const) {
        const D = dir === 'asc' ? sql`ASC` : sql`DESC`;
        const want = (
          await db.$queryRaw<{id: string}[]>(sql`SELECT id FROM responses WHERE form_id = ${SMALL}::uuid
            ORDER BY ${Prisma.raw(column)} ${D} NULLS LAST, id ${D}`)
        ).map(r => r.id);
        // Forwards, 25 a page.
        const got: string[] = [];
        let cursor: string | null = null;
        for (let p = 1; p < 50; p++) {
          const page = await listResponses(db, small, {...filters({sort, dir}), cursor: cursor ? decodeCursor(cursor) : null, page: p, size: 25});
          got.push(...page.rows.map(r => r.id));
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        expect(got, `${sort} ${dir} forwards`).toEqual(want);
        // Backwards from the last page (300 = 12 × 25).
        const back: string[] = [];
        let page = await listResponses(db, small, {...filters({sort, dir}), cursor: null, last: 25, page: 12, size: 25});
        back.unshift(...page.rows.map(r => r.id));
        while (page.prevCursor) {
          page = await listResponses(db, small, {...filters({sort, dir}), cursor: null, before: decodeCursor(page.prevCursor), page: 1, size: 25});
          back.unshift(...page.rows.map(r => r.id));
        }
        expect(back, `${sort} ${dir} backwards`).toEqual(want);
        // The drawer's prev / next: at both ends, and around the answered / unanswered seam.
        const seam = (
          await db.$queryRaw<{n: number}[]>(sql`SELECT count(*)::int AS n FROM responses WHERE form_id = ${SMALL}::uuid AND ${Prisma.raw(column)} IS NOT NULL`)
        )[0]!.n;
        for (const i of [0, 1, seam - 1, seam, seam + 1, want.length - 1]) {
          const d = (await responseDetail(db, small, want[i]!, filters({sort, dir})))!;
          expect([d.prevId, d.nextId], `${sort} ${dir} drawer at ${i}`).toEqual([want[i - 1] ?? null, want[i + 1] ?? null]);
        }
      }
    }
  }, 120_000);

  it('serves the metadata sorts from their (form_id, column, id) index', async () => {
    const cols = sql`id, submitted_at, (duration_ms)::text AS sort_key`;
    for (const [sort, column] of Object.entries(META)) {
      for (const dir of ['asc', 'desc'] as const) {
        const s = sortSpec(big, sort, dir);
        const where = whereFragment(big, filters({sort, dir}), 'UTC');
        const first = await plan(pageQuery(s, where, cols, {kind: 'first'}, 51));
        expect(first, `${sort} ${dir}`).toContain(`responses_form_id_${column}_id_idx`);
        expect(first).not.toContain('Seq Scan');
        // The unanswered part walks the same index (by id), not the primary key.
        expect(first).not.toContain('responses_pkey');
        // A cursor in the middle: still an index walk that starts at the cursor.
        const [mid] = await db.$queryRaw<{k: string; id: string}[]>(
          sql`SELECT (${s.expr})::text AS k, id FROM responses WHERE form_id = ${BIG}::uuid AND ${s.expr} IS NOT NULL ORDER BY id LIMIT 1`
        );
        for (const kind of ['after', 'before'] as const) {
          const from: PageFrom = {kind, cur: {k: mid!.k, id: mid!.id}};
          const p = await plan(pageQuery(s, where, cols, from, 51));
          expect(p, `${sort} ${dir} ${kind}`).toContain(`responses_form_id_${column}_id_idx`);
          expect(p).toMatch(/Index Cond: .*ROW\(/);
          expect(p).not.toContain('Seq Scan');
        }
        // A cursor on an unanswered row: the unanswered part starts at its id.
        const [none] = await db.$queryRaw<{id: string}[]>(
          sql`SELECT id FROM responses WHERE form_id = ${BIG}::uuid AND ${s.expr} IS NULL ORDER BY id LIMIT 1 OFFSET 10`
        );
        for (const kind of ['after', 'before'] as const) {
          const p = await plan(pageQuery(s, where, cols, {kind, cur: {k: null, id: none!.id}}, 51));
          expect(p, `${sort} ${dir} ${kind} null`).toMatch(new RegExp(`Index Cond: .*${column} IS NULL\\) AND \\(id [<>]`));
          expect(p).not.toContain('Seq Scan');
          expect(p).not.toContain('responses_pkey');
        }
      }
    }
  });

  it('looks for has / search within the newest rows only, through the submitted_at index', async () => {
    const window = windowFragment(BIG, 4_990);
    const where = sql`${whereFragment(big, filters({has: 'f_rare0001'}), 'UTC')} AND ${window}`;
    const s = sortSpec(big, 'submitted_at', 'desc');
    const p = await plan(pageQuery(s, where, sql`id`, {kind: 'first'}, 51));
    // An index range on submitted_at that stops at the window's boundary (with one form in the
    // test database the planner may take the plain submitted_at index; with many, the per-form one).
    expect(p).toMatch(/Index Cond: .*submitted_at/);
    expect(p).not.toContain('Seq Scan');
    // The bound holds: only the rare answers among the newest 4,990 (997, 1,994, … 4,985).
    const rows = await db.$queryRaw<{id: string}[]>(pageQuery(s, where, sql`id`, {kind: 'first'}, 51));
    expect(rows).toHaveLength(5);
    const all = await db.$queryRaw<{id: string}[]>(pageQuery(s, whereFragment(big, filters({has: 'f_rare0001'}), 'UTC'), sql`id`, {kind: 'first'}, 51));
    expect(all).toHaveLength(20);
    // Search the same way.
    const searched = await db.$queryRaw<{n: number}[]>(
      sql`SELECT count(*)::int AS n FROM responses WHERE ${whereFragment(big, filters({q: 'needle'}), 'UTC')} AND ${window}`
    );
    expect(searched[0]!.n).toBe(4);
  });

  it('applies the window on a form bigger than it, and says so; a smaller form is read whole', async () => {
    // As if the form held 200,000 responses: has / search reads the newest 100,000 (here: all
    // 20,000, the boundary falls back to "every row").
    const huge: FormCatalog = {...big, form: {...big.form, responseCount: 200_000}};
    const has = await listResponses(db, huge, {...filters({has: 'f_rare0001'}), cursor: null, page: 1});
    expect(has.window).toEqual({size: 100_000, reason: 'search'});
    expect(has.total).toBe(20);
    const sorted = await listResponses(db, huge, {...filters({sort: 'f_num00001', dir: 'desc'}), cursor: null, page: 1});
    expect(sorted.window).toEqual({size: 50_000, reason: 'sort'});
    expect(sorted.rows).toHaveLength(50);
    const plain = await listResponses(db, big, {...filters({has: 'f_rare0001'}), cursor: null, page: 1});
    expect(plain.window).toBeNull();
    expect(plain.total).toBe(20);
    expect(tableWhere(huge, filters({}), safeTz('UTC')).window).toBeNull();
  });

  it('sends the catalog only from either end, and only the visible columns’ cells', async () => {
    const first = await listResponses(db, big, {...filters(), cursor: null, page: 1, col: ['submitted_at', 'f_num00001']});
    expect(first.fields?.map(f => f.id)).toEqual(['f_text0001', 'f_rare0001', 'f_num00001']);
    expect(Object.keys(first.rows[0]!.cells)).toEqual(['f_num00001']);
    const next = await listResponses(db, big, {...filters(), cursor: decodeCursor(first.nextCursor!), page: 2, col: ['submitted_at']});
    expect(next.fields).toBeUndefined();
    expect(next.rows[0]!.cells).toEqual({});
    const all = await listResponses(db, big, {...filters(), cursor: null, page: 1});
    expect(Object.keys(all.rows[0]!.cells).sort()).toEqual(['f_num00001', 'f_text0001']);
  });

  it('labels the drawer from the version’s fields alone', async () => {
    const [row] = await db.$queryRaw<{id: string}[]>`SELECT id FROM responses WHERE form_id = ${BIG}::uuid ORDER BY submitted_at DESC, id DESC LIMIT 1`;
    const d = (await responseDetail(db, big, row!.id, filters()))!;
    expect(d.answers.map(a => a.label)).toEqual(['Answer', 'Rarely answered', 'A number']);
    expect(d.prevId).toBeNull();
    expect(d.nextId).not.toBeNull();
  });
});
