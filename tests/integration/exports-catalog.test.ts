import {afterAll, beforeEach, describe, expect, it} from 'vitest';

import {JobRejected} from '../../src/platform/background';
import {publishInTx} from '../../src/server/intelform/builder/publish';
import {runExportJob, resendPendingExports} from '../../src/server/intelform/exports/job';
import {EMPTY_CATALOG, finishCatalog, foldVersions, loadCatalog, type VersionFields} from '../../src/server/intelform/responses/catalog';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The precomputed responses catalog (form_catalogs) and an export built over several runs,
 * against a real Postgres with every migration applied.
 */

const field = (id: string, label: string, type = 'short_text', props: Record<string, unknown> = {}) => ({
  id,
  type,
  label,
  description: 'Help text that the catalog never needs',
  required: false,
  props,
});
const def = (fields: unknown[]) => ({layout: 'all_at_once', startScreen: {enabled: false}, endScreen: {title: 'Thanks'}, fields});
const V1 = def([field('f_name0001', 'Name'), field('f_pick0001', 'Colour', 'single_choice', {options: [{id: 'o_red0', label: 'Red'}, {id: 'o_blu0', label: 'Blue'}]})]);
const V2 = def([field('f_pick0001', 'Favourite colour', 'single_choice', {options: [{id: 'o_red0', label: 'Red'}]}), field('f_mail0001', 'Email', 'email')]);
const V3 = def([field('f_mail0001', 'Work email', 'email'), field('f_new00001', 'Anything else?')]);

async function user(): Promise<number> {
  const [u] = await db.$queryRaw<{id: number}[]>`
    INSERT INTO users (email, password_hash, name, updated_at) VALUES ('c1@example.com', 'x', 'C1', now()) RETURNING id`;
  return u!.id;
}

async function form(versions: unknown[]): Promise<{id: string; versionIds: string[]}> {
  const [f] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO forms (slug, title, status, draft, settings, theme)
    VALUES ('survey', 'Survey', 'live', ${JSON.stringify(versions.at(-1))}::jsonb, '{}'::jsonb, '{}'::jsonb) RETURNING id::text AS id`;
  const versionIds: string[] = [];
  for (const [i, d] of versions.entries()) {
    const [v] = await db.$queryRaw<{id: string}[]>`
      INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${f!.id}::uuid, ${i + 1}, ${JSON.stringify(d)}::jsonb, '{}'::jsonb)
      RETURNING id::text AS id`;
    versionIds.push(v!.id);
  }
  await db.$executeRaw`UPDATE forms SET published_version_id = ${versionIds.at(-1)}::uuid WHERE id = ${f!.id}::uuid`;
  return {id: f!.id, versionIds};
}

const storedRow = async (formId: string) =>
  (await db.$queryRaw<{version_id: string | null; catalog: unknown}[]>`
    SELECT version_id::text AS version_id, catalog FROM form_catalogs WHERE form_id = ${formId}::uuid`)[0] ?? null;

describe.skipIf(!DATABASE_URL)('form catalogs and long exports (integration, real Postgres)', () => {
  beforeEach(async () => {
    configureEnv();
    await resetDatabase();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('a form published before catalogs is rebuilt on its first read, stored, then merged at each publish', async () => {
    const userId = await user();
    const f = await form([V1, V2]);
    expect(await storedRow(f.id)).toBeNull();

    const first = (await loadCatalog(db, f.id))!;
    expect(first.entries.map(e => [e.meta.id, e.meta.deleted])).toEqual([
      ['f_pick0001', false],
      ['f_mail0001', false],
      ['f_name0001', true],
    ]);
    const row = (await storedRow(f.id))!;
    expect(row.version_id).toBe(f.versionIds[1]);
    expect(JSON.stringify(row.catalog)).not.toContain('Help text');

    // Publish v3: the catalog moves on in the same transaction, the same as reading every version.
    await db.$executeRaw`UPDATE forms SET draft = ${JSON.stringify(V3)}::jsonb, has_unpublished = true WHERE id = ${f.id}::uuid`;
    const published = await db.$transaction(tx => publishInTx(tx, f.id, userId));
    expect(published.version).toBe(3);
    const after = (await storedRow(f.id))!;
    const versions = await db.$queryRaw<VersionFields[]>`
      SELECT id::text AS id, version, definition->'fields' AS fields FROM form_versions WHERE form_id = ${f.id}::uuid`;
    const live = versions.find(v => v.version === 3)!;
    expect(after.version_id).toBe(live.id);
    const folded = foldVersions(EMPTY_CATALOG, versions, live.id, null);
    expect(after.catalog).toEqual(finishCatalog(folded.cat, folded.published));
    const cat = (await loadCatalog(db, f.id))!;
    expect(cat.entries.map(e => e.meta.label)).toEqual(['Work email', 'Anything else?', 'Favourite colour (deleted)', 'Name (deleted)']);
    expect(cat.byId.get('f_pick0001')!.meta.options!.map(o => o.label)).toEqual(['Red', 'Blue (deleted option)']);
  });

  it('a stale or missing previous catalog is not merged into: the next read rebuilds it', async () => {
    const userId = await user();
    const f = await form([V1]);
    await db.$executeRaw`UPDATE forms SET draft = ${JSON.stringify(V2)}::jsonb, has_unpublished = true WHERE id = ${f.id}::uuid`;
    await db.$transaction(tx => publishInTx(tx, f.id, userId));
    expect(await storedRow(f.id)).toBeNull();
    const cat = (await loadCatalog(db, f.id))!;
    expect(cat.entries.map(e => e.meta.id)).toEqual(['f_pick0001', 'f_mail0001', 'f_name0001']);
    // A first publish starts the catalog itself.
    await db.$executeRaw`DELETE FROM forms`;
    const [fresh] = await db.$queryRaw<{id: string}[]>`
      INSERT INTO forms (slug, title, status, draft, settings, theme, has_unpublished)
      VALUES ('new', 'New', 'draft', ${JSON.stringify(V1)}::jsonb, '{}'::jsonb, '{}'::jsonb, true) RETURNING id::text AS id`;
    await db.$transaction(tx => publishInTx(tx, fresh!.id, userId));
    expect((await storedRow(fresh!.id))!.version_id).not.toBeNull();
  });

  it('exports a few thousand rows over several runs; a refused send waits for the every-minute job', async () => {
    const userId = await user();
    const f = await form([V1]);
    const N = 3200;
    await db.$executeRaw`
      INSERT INTO responses (form_id, form_version_id, answers, submitted_at, device, country)
      SELECT ${f.id}::uuid, ${f.versionIds[0]}::uuid,
        jsonb_build_object('f_name0001', 'Person ' || g, 'f_pick0001', 'o_red0'),
        now() - make_interval(secs => g), 'desktop', 'GB'
      FROM generate_series(1, ${N}::int) g`;
    const [exp] = await db.$queryRaw<{id: string}[]>`
      INSERT INTO intelform_exports (user_id, kind, form_id, params, file_name, content_type)
      VALUES (${userId}, 'responses', ${f.id}::uuid, ${JSON.stringify({query: {}, tz: 'UTC', origin: null})}::jsonb, 'survey.csv', 'text/csv')
      RETURNING id::text AS id`;
    const id = exp!.id;

    // A clock that moves 10 s each time it is read: a run stops after a few batches (its 30 s budget).
    let clock = 0;
    const now = () => (clock += 10_000);
    const sent: number[] = [];
    let refuse = true;
    const send = async (_url: string, _id: string, step: number) => {
      if (refuse) {
        refuse = false;
        throw new JobRejected('Too many jobs', 'rate_limited', 429);
      }
      sent.push(step);
    };
    await runExportJob(db, 'https://shop.example.test/x', {exportId: id}, {now, send});
    // Refused: the export is not failed, it waits for the every-minute job.
    let [row] = await db.$queryRaw<{status: string; send_pending: boolean; runs: number}[]>`
      SELECT status, send_pending, runs FROM intelform_exports WHERE id = ${id}::uuid`;
    expect(row).toMatchObject({status: 'running', send_pending: true, runs: 1});
    expect(await resendPendingExports(db, 'https://shop.example.test/x', {send})).toBe(1);
    expect(sent).toEqual([1]);
    [row] = await db.$queryRaw`SELECT status, send_pending, runs FROM intelform_exports WHERE id = ${id}::uuid`;
    expect(row!.send_pending).toBe(false);

    for (let i = 0; i < 50 && row!.status === 'running'; i++) {
      await runExportJob(db, 'https://shop.example.test/x', {exportId: id}, {now, send});
      [row] = await db.$queryRaw`SELECT status, send_pending, runs FROM intelform_exports WHERE id = ${id}::uuid`;
    }
    expect(row!.status).toBe('ready');
    expect(row!.runs).toBeGreaterThan(2);
    // Each run's next run had its own job key.
    expect(new Set(sent).size).toBe(sent.length);

    const parts = await db.$queryRaw<{data: Uint8Array}[]>`
      SELECT data FROM intelform_export_parts WHERE export_id = ${id}::uuid ORDER BY seq`;
    const csv = Buffer.concat(parts.map(p => Buffer.from(p.data))).toString('utf8');
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(N + 1);
    expect(lines[0]).toContain('Name');
    expect(new Set(lines.slice(1).map(l => l.split(',')[0])).size).toBe(N);
    const [{rows}] = await db.$queryRaw<{rows: number}[]>`SELECT rows FROM intelform_exports WHERE id = ${id}::uuid`;
    expect(rows).toBe(N);
  });
});
