import {afterAll, describe, expect, it} from 'vitest';

import {responsesFilterQuery, summaryQuery} from '../../src/lib/intelform/api-responses';
// The Node build of the client, as the vitest alias maps the app's own import.
import {Prisma} from '../../src/generated/prisma-node/client';
import {createDb, type PrismaClient} from '../../src/platform/db';
import {loadCatalog} from '../../src/server/intelform/responses/catalog';
import {buildPart, type BuildContext, type BuildState} from '../../src/server/intelform/exports/builders';
import {decodeCursor, encodeCursor, sortSpec} from '../../src/server/intelform/responses/query';
import {formSummary} from '../../src/server/intelform/responses/summary';
import {deleteResponses, listResponses, responseDetail} from '../../src/server/intelform/responses/table';
import {syncFormCounts} from '../../src/server/intelform/forms/counts';

/**
 * The Responses SQL against a real Postgres holding the sample data (prisma/seed.sql): every
 * query runs, nothing is changed (deletes run in a transaction that is rolled back). Skipped
 * unless RESPONSES_SQL_DATABASE_URL names a database with the seed loaded:
 *
 *   RESPONSES_SQL_DATABASE_URL=postgresql://…/site npx vitest run tests/intelform/responses-sql.test.ts
 */

const URL_ = process.env.RESPONSES_SQL_DATABASE_URL ?? '';
const CONTACT = '00000000-0000-4000-8000-00000000f001';
const NPS = '00000000-0000-4000-8000-00000000f002';

describe.skipIf(!URL_)('responses SQL on the sample data', () => {
  let db: PrismaClient;
  const getDb = () => (db ??= createDb(URL_));
  afterAll(async () => {
    await db?.$disconnect();
  });

  const filters = (v: Record<string, unknown> = {}) => responsesFilterQuery.parse(v);

  it('lists, filters, sorts by every column and pages by cursor', async () => {
    const db = getDb();
    for (const formId of [CONTACT, NPS]) {
      const cat = (await loadCatalog(db, formId))!;
      expect(cat.entries.length).toBeGreaterThan(0);
      const all = await listResponses(db, cat, {
        ...filters(),
        cursor: null,
        page: 1,
      });
      expect(all.rows.length).toBe(Math.min(all.formTotal, 50));
      expect(all.total).toBe(cat.form.responseCount);
      const columns = ['submitted_at', 'duration', 'device', 'browser', 'country', ...cat.entries.map(e => e.meta.id)];
      for (const sort of columns) {
        for (const dir of ['asc', 'desc'] as const) {
          const page = await listResponses(db, cat, {
            ...filters({sort, dir}),
            cursor: null,
            page: 1,
          });
          expect(page.rows.length, sort).toBe(all.rows.length);
          // Each row's detail: prev / next agree with the table order.
          const ids = page.rows.map(r => r.id);
          for (let i = 0; i < Math.min(ids.length, 3); i++) {
            const d = (await responseDetail(db, cat, ids[i], filters({sort, dir})))!;
            expect(d.prevId).toBe(i ? ids[i - 1] : null);
            expect(d.nextId).toBe(ids[i + 1] ?? null);
          }
        }
      }
      const searched = await listResponses(db, cat, {
        ...filters({q: 'example', from: '2000-01-01', tz: 'Europe/Berlin'}),
        cursor: null,
        page: 1,
      });
      expect(searched.total).toBeLessThanOrEqual(all.formTotal);
      for (const e of cat.entries.filter(x => x.meta.filterable)) {
        const opt = e.meta.options?.[0]?.id ?? (e.meta.type === 'nps' ? '9' : e.meta.type === 'rating' ? '5' : 'DE');
        const f = await listResponses(db, cat, {
          ...filters({filter: [`${e.meta.id}:${opt}`], has: e.meta.id}),
          cursor: null,
          page: 1,
        });
        expect(f.total).toBeLessThanOrEqual(all.formTotal);
      }
    }
  });

  it('pages by keyset with a cursor after any row', async () => {
    const db = getDb();
    const cat = (await loadCatalog(db, NPS))!;
    for (const sort of ['submitted_at', ...cat.entries.map(e => e.meta.id)]) {
      for (const dir of ['asc', 'desc'] as const) {
        const page = await listResponses(db, cat, {
          ...filters({sort, dir}),
          cursor: null,
          page: 1,
        });
        const ids = page.rows.map(r => r.id);
        const keys = await db.$queryRaw<{id: string}[]>`SELECT id FROM responses WHERE form_id = ${NPS}::uuid`;
        expect(keys.length).toBe(ids.length);
        // Cursor after row i: the server's own sort key for that row.
        for (let i = 0; i < ids.length - 1; i++) {
          const rest = await listResponses(db, cat, {
            ...filters({sort, dir}),
            cursor: await cursorAfter(db, cat, sort, dir, ids[i]),
            page: 2,
          });
          expect(
            rest.rows.map(r => r.id),
            `${sort} ${dir} after ${i}`
          ).toEqual(ids.slice(i + 1));
        }
      }
    }
  });

  it('summarises every range', async () => {
    const db = getDb();
    for (const formId of [CONTACT, NPS]) {
      const cat = (await loadCatalog(db, formId))!;
      for (const range of ['7d', '30d', '90d', 'all'] as const) {
        const s = await formSummary(db, cat, summaryQuery.parse({range, tz: 'America/New_York'}));
        expect(s.series.length).toBeGreaterThanOrEqual(range === 'all' ? 1 : 7);
        expect(s.series.at(-1)?.day).toBe(s.range.to);
        expect(s.totals.responses).toBeLessThanOrEqual(s.formTotal);
        expect(s.questions.length).toBeGreaterThan(0);
      }
      const all = await formSummary(
        db,
        cat,
        summaryQuery.parse({
          range: 'custom',
          from: '2020-01-01',
          to: '2029-12-31',
        })
      );
      expect(all.totals.responses).toBe(cat.form.responseCount);
    }
  });

  it('exports CSV and a ZIP of every form a bounded step at a time (the export job)', async () => {
    const db = getDb();
    const cat = (await loadCatalog(db, CONTACT))!;
    const build = async (ctx: BuildContext) => {
      let state: BuildState = {};
      const parts: Uint8Array[] = [];
      for (let i = 0; i < 100_000; i++) {
        const step = await buildPart(ctx, state);
        parts.push(step.bytes);
        state = step.state;
        if (step.done) break;
      }
      return Buffer.concat(parts);
    };
    const csv = (await build({db, kind: 'responses', formId: CONTACT, params: {query: {}, tz: 'UTC', origin: null}})).toString('utf8');
    expect(csv.split('\r\n').filter(Boolean).length).toBe(cat.form.responseCount + 1);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const zip = await build({db, kind: 'all', formId: null, params: {}});
    expect(zip.length).toBeGreaterThan(100);
    // Ends with the end-of-central-directory record.
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('deletes; the exact count moves at once and the copy with the sync (rolled back)', async () => {
    const db = getDb();
    const cat = (await loadCatalog(db, CONTACT))!;
    const page = await listResponses(db, cat, {
      ...filters(),
      cursor: null,
      page: 1,
    });
    const ids = page.rows.slice(0, 2).map(r => r.id);
    const ROLLBACK = new Error('rollback');
    await expect(
      db.$transaction(async tx => {
        const t = tx as unknown as PrismaClient;
        const r = await deleteResponses(t, CONTACT, [...ids, '00000000-0000-4000-8000-0000000000ff']);
        expect(r).toEqual({formFound: true, deleted: 2});
        // The exact count (form_counts, kept by the delete trigger) moves at once…
        expect((await loadCatalog(t, CONTACT))!.form.responseCount).toBe(cat.form.responseCount - 2);
        // …and the copy on forms with the every-minute sync, last_response_at moving back too.
        await syncFormCounts(t);
        const [form] = await t.$queryRaw<{response_count: number; last: Date | null}[]>`
          SELECT response_count, last_response_at AS last FROM forms WHERE id = ${CONTACT}::uuid`;
        expect(form.response_count).toBe(cat.form.responseCount - 2);
        const [max] = await t.$queryRaw<{m: Date | null}[]>`SELECT max(submitted_at) AS m FROM responses WHERE form_id = ${CONTACT}::uuid`;
        expect(form.last?.getTime() ?? null).toBe(max.m?.getTime() ?? null);
        expect(await deleteResponses(t, '00000000-0000-4000-8000-0000000000fe', ids)).toMatchObject({formFound: false, deleted: 0});
        throw ROLLBACK;
      })
    ).rejects.toBe(ROLLBACK);
    const after = (await loadCatalog(db, CONTACT))!;
    expect(after.form.responseCount).toBe(cat.form.responseCount);
  });
});

/** The cursor the server would hand out after row `id` (its sort key read back as text). */
async function cursorAfter(
  db: PrismaClient,
  cat: NonNullable<Awaited<ReturnType<typeof loadCatalog>>>,
  sort: string,
  dir: 'asc' | 'desc',
  id: string
) {
  // listResponses hands out nextCursor only past 50 rows: read the key the same way directly.
  const s = sortSpec(cat, sort, dir);
  const [row] = await db.$queryRaw<{k: string | null}[]>(Prisma.sql`SELECT (${s.expr})::text AS k FROM responses WHERE id = ${id}::uuid`);
  const c = decodeCursor(encodeCursor({k: row.k, id}));
  expect(c).not.toBeNull();
  return c;
}
