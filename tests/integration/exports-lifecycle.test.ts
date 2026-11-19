import {afterAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
// Registers the job handlers: locally an export job runs as soon as it is sent.
import {applyRetention, hourlyMaintenance} from '../../src/server/background';
import {runExportJob, STALE_MINUTES} from '../../src/server/intelform/exports/job';
import {unzip} from '../intelform/unzip';
import {type Browser, configureEnv, DATABASE_URL, db, downloadExport, fetchText, ownerAccountId, ownerSignedIn, resetDatabase, storageFailure, storedFiles} from './support/harness';

/**
 * Exports never outlive the responses in them (F-010), and an export whose job stopped says so
 * (F-025). Against a real Postgres: the responses delete trigger, the status route, the job.
 */

const F = {name: 'f_name0001', email: 'f_email001', text: 'f_text0001'};
const DEF = JSON.stringify({
  layout: 'all_at_once',
  startScreen: {enabled: false},
  endScreen: {title: 'Thanks'},
  fields: [
    {id: F.name, type: 'name', label: 'name', required: false, props: {split: true}},
    {id: F.email, type: 'email', label: 'email', required: false, props: {}},
    {id: F.text, type: 'short_text', label: 'Anything else?', required: false, props: {}},
  ],
});

async function form(title: string) {
  const slug = title.toLowerCase().replace(/\W+/g, '-');
  const [f] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO forms (slug, title, status, draft, settings, theme) VALUES (${slug}, ${title}, 'live', ${DEF}::jsonb, '{}'::jsonb, '{}'::jsonb) RETURNING id::text AS id`;
  const [v] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${f!.id}::uuid, 1, ${DEF}::jsonb, '{}'::jsonb) RETURNING id::text AS id`;
  await db.$executeRaw`UPDATE forms SET published_version_id = ${v!.id}::uuid WHERE id = ${f!.id}::uuid`;
  return {id: f!.id, versionId: v!.id};
}

async function respond(fm: {id: string; versionId: string}, email: string, daysAgo = 0): Promise<string> {
  const answers = {[F.name]: {first: 'Ada', last: 'Lovelace'}, [F.email]: email, [F.text]: 'hello'};
  const [r] = await db.$queryRaw<{id: string}[]>`
    INSERT INTO responses (form_id, form_version_id, answers, submitted_at, device, country)
    VALUES (${fm.id}::uuid, ${fm.versionId}::uuid, ${JSON.stringify(answers)}::jsonb, now() - make_interval(days => ${daysAgo}), 'desktop', 'GB')
    RETURNING id::text AS id`;
  await db.$executeRaw`
    UPDATE forms SET response_count = (SELECT count(*) FROM responses WHERE form_id = ${fm.id}::uuid),
      last_response_at = (SELECT max(submitted_at) FROM responses WHERE form_id = ${fm.id}::uuid) WHERE id = ${fm.id}::uuid`;
  return r!.id;
}

const parts = async (id: string) => Number((await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM intelform_export_parts WHERE export_id = ${id}::uuid`)[0]!.n);

describe.skipIf(!DATABASE_URL)('exports lifecycle (integration, real Postgres)', () => {
  let owner: Browser;
  let survey: {id: string; versionId: string};
  let other: {id: string; versionId: string};

  async function startExport(body: Record<string, unknown>): Promise<string> {
    const res = await owner.post('/site-api/exports', body);
    expect(res.status).toBe(202);
    const job = res.json as {id: string; status: string};
    expect(job.status).toBe('ready');
    return job.id;
  }

  async function download(id: string) {
    const res = await owner.get(`/site-api/exports/${id}/files`);
    if (res.status !== 200) return {status: res.status, text: ''};
    const files = (res.json as {files: {url: string}[]}).files;
    const texts = await Promise.all(files.map(f => fetchText(f.url)));
    return {status: res.status, text: texts.join('')};
  }

  async function expectStopped(id: string) {
    expect((await download(id)).status).not.toBe(200);
    const status = await owner.get(`/site-api/exports/${id}`);
    expect(status.json).toMatchObject({status: 'failed'});
    expect(String((status.json as {error: string}).error)).toMatch(/deleted/);
    expect(await parts(id)).toBe(0);
  }

  beforeEach(async () => {
    configureEnv();
    await resetDatabase();
    owner = await ownerSignedIn(app, undefined, '203.0.113.71');
    await owner.get('/site-api/me');
    survey = await form('Customer survey');
    other = await form('Event signup');
  });

  afterAll(async () => {
    await db.intelformSettings.updateMany({data: {retentionDays: null}});
    await db.$disconnect();
  });

  it('a contact erase stops every contacts export and every export of the forms it touched', async () => {
    await respond(survey, 'ada@example.com');
    await respond(survey, 'bob@example.com');
    await respond(other, 'carol@example.com');
    const contacts = await startExport({kind: 'contacts', query: {tz: 'UTC'}});
    const surveyCsv = await startExport({kind: 'responses', formId: survey.id, query: {tz: 'UTC'}});
    const otherCsv = await startExport({kind: 'responses', formId: other.id, query: {tz: 'UTC'}});
    const all = await startExport({kind: 'all'});
    const before = await download(contacts);
    expect(before.status).toBe(200);
    expect(before.text).toContain('ada@example.com');

    const erased = await owner.post('/site-api/contacts/delete', {keys: ['e:ada@example.com']});
    expect(erased.json).toEqual({contacts: 1, responses: 1});

    await expectStopped(contacts);
    await expectStopped(surveyCsv);
    await expectStopped(all);
    // A form with none of the erased responses keeps its export.
    expect((await download(otherCsv)).status).toBe(200);
    // A new export reads only what is left.
    const again = await download(await startExport({kind: 'contacts', query: {tz: 'UTC'}}));
    expect(again.status).toBe(200);
    expect(again.text).not.toContain('ada@example.com');
    expect(again.text).toContain('bob@example.com');
  });

  it('deleting one response stops the exports that held it', async () => {
    const rid = await respond(survey, 'ada@example.com');
    const surveyCsv = await startExport({kind: 'responses', formId: survey.id, query: {tz: 'UTC'}});
    expect((await download(surveyCsv)).text).toContain('ada@example.com');
    expect((await owner.delete(`/site-api/responses/forms/${survey.id}/responses/${rid}`)).json).toEqual({deleted: 1});
    await expectStopped(surveyCsv);
  });

  it('retention stops the exports that held the responses it deleted', async () => {
    await respond(survey, 'old@example.com', 40);
    await respond(survey, 'new@example.com', 1);
    const contacts = await startExport({kind: 'contacts', query: {tz: 'UTC'}});
    const all = await startExport({kind: 'all'});
    expect((await download(contacts)).text).toContain('old@example.com');
    await db.intelformSettings.upsert({where: {id: 1}, create: {id: 1, retentionDays: 30}, update: {retentionDays: 30}});
    try {
      expect((await applyRetention(db as never)).responses).toBe(1);
    } finally {
      await db.intelformSettings.updateMany({data: {retentionDays: null}});
    }
    await expectStopped(contacts);
    await expectStopped(all);
  });

  it('a delete that removes nothing leaves every export downloadable', async () => {
    const rid = await respond(survey, 'ada@example.com', 1);
    const contacts = await startExport({kind: 'contacts', query: {tz: 'UTC'}});
    const surveyCsv = await startExport({kind: 'responses', formId: survey.id, query: {tz: 'UTC'}});
    const all = await startExport({kind: 'all'});
    // Retention on, but nothing is past the period: its DELETE statement removes no rows.
    await db.intelformSettings.upsert({where: {id: 1}, create: {id: 1, retentionDays: 30}, update: {retentionDays: 30}});
    try {
      expect((await applyRetention(db as never)).responses).toBe(0);
    } finally {
      await db.intelformSettings.updateMany({data: {retentionDays: null}});
    }
    // Deleting a response id that isn't there, and erasing a contact with no responses.
    const missing = '00000000-0000-4000-8000-0000000000ff';
    await db.$executeRaw`DELETE FROM responses WHERE id = ${missing}::uuid`;
    expect((await owner.post('/site-api/contacts/delete', {keys: ['e:nobody@example.com']})).json).toEqual({contacts: 0, responses: 0});
    for (const id of [contacts, surveyCsv, all]) {
      expect((await owner.get(`/site-api/exports/${id}`)).json).toMatchObject({status: 'ready'});
      expect((await download(id)).status).toBe(200);
    }
    expect(rid).toBeTruthy();
  });

  it('deleting a form stops the contacts and all-responses exports', async () => {
    await respond(survey, 'ada@example.com');
    const contacts = await startExport({kind: 'contacts', query: {tz: 'UTC'}});
    await db.$executeRaw`DELETE FROM forms WHERE id = ${survey.id}::uuid`;
    await expectStopped(contacts);
  });

  it('a running export with no progress for a while reads as failed (status route and hourly job)', async () => {
    const userId = await ownerAccountId();
    const insert = async (minutesAgo: number) => {
      const [row] = await db.$queryRaw<{id: string}[]>`
        INSERT INTO intelform_exports (user_id, kind, params, file_name, content_type, status, updated_at, created_at)
        VALUES (${userId}, 'contacts', '{}'::jsonb, 'c.csv', 'text/csv', 'running',
          now() - make_interval(mins => ${minutesAgo}::int), now() - make_interval(mins => ${minutesAgo}::int))
        RETURNING id::text AS id`;
      await db.$executeRaw`INSERT INTO intelform_export_parts (export_id, seq, file_id, size, ready) VALUES (${row!.id}::uuid, 0, ${`file_${row!.id.replace(/-/g, '').slice(0, 26)}`}, 2, true)`;
      return row!.id;
    };
    const stale = await insert(STALE_MINUTES + 5);
    const fresh = await insert(1);
    const byJob = await insert(STALE_MINUTES + 5);

    const res = await owner.get(`/site-api/exports/${stale}`);
    expect(res.json).toMatchObject({status: 'failed', error: 'The export didn’t finish. Try again.'});
    expect(await parts(stale)).toBe(0);
    expect((await owner.get(`/site-api/exports/${fresh}`)).json).toMatchObject({status: 'running'});

    const out = await hourlyMaintenance(db as never, {drain: async () => ({removed: 0, failed: 0, more: false})});
    expect(out.staleExports).toBe(1);
    expect((await owner.get(`/site-api/exports/${byJob}`)).json).toMatchObject({status: 'failed'});
    expect((await owner.get(`/site-api/exports/${fresh}`)).json).toMatchObject({status: 'running'});
  });

  it('the last try of an export job that fails marks the export failed', async () => {
    await respond(survey, 'ada@example.com');
    const userId = await ownerAccountId();
    const [row] = await db.$queryRaw<{id: string}[]>`
      INSERT INTO intelform_exports (user_id, kind, params, file_name, content_type)
      VALUES (${userId}, 'contacts', ${JSON.stringify({query: {}, tz: 'UTC'})}::jsonb, 'c.csv', 'text/csv')
      RETURNING id::text AS id`;
    const id = row!.id;
    // A run that can't read the database (it throws: the platform tries again later).
    const broken = {
      $queryRaw: () => Promise.reject(new Error('database busy')),
      $executeRaw: (sql: TemplateStringsArray, ...values: unknown[]) => db.$executeRaw(sql, ...values),
    };
    const run = (lastTry: boolean) => runExportJob(broken as never, 'https://shop.example.test/x', {exportId: id}, {lastTry});
    // An earlier try leaves it running (the next try carries on)…
    await expect(run(false)).rejects.toThrow('database busy');
    expect((await owner.get(`/site-api/exports/${id}`)).json).toMatchObject({status: 'running'});
    // …the last try marks it failed.
    await expect(run(true)).rejects.toThrow('database busy');
    expect((await owner.get(`/site-api/exports/${id}`)).json).toMatchObject({status: 'failed', error: 'The export didn’t finish. Try again.'});
  });
  it('keeps the export in file storage (ids in the database, never bytes); the 24-hour sweep removes the stored files', async () => {
    await respond(survey, 'ada@example.com');
    const id = await startExport({kind: 'responses', formId: survey.id, query: {tz: 'UTC'}});
    const [part] = await db.$queryRaw<{file_id: string; size: number; ready: boolean}[]>`
      SELECT file_id, size, ready FROM intelform_export_parts WHERE export_id = ${id}::uuid`;
    expect(part).toMatchObject({ready: true});
    const cols = await db.$queryRaw<{column_name: string}[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'intelform_export_parts'`;
    expect(cols.map(c => c.column_name)).not.toContain('data');
    const stored = storedFiles.get(part!.file_id)!;
    expect(stored).toMatchObject({ready: true, size: part!.size, contentType: 'text/csv'});
    expect((await download(id)).text).toContain('ada@example.com');
    // A day later: the sweep deletes the export, its part goes, its file goes to the trash and
    // the same hourly run removes it from storage.
    await db.$executeRaw`UPDATE intelform_exports SET created_at = now() - interval '25 hours' WHERE id = ${id}::uuid`;
    const out = await hourlyMaintenance(db as never);
    expect(out.exports).toBe(1);
    expect(out.files).toBeGreaterThanOrEqual(1);
    expect(storedFiles.has(part!.file_id)).toBe(false);
    expect((await owner.get(`/site-api/exports/${id}/files`)).status).toBe(404);
  });

  it('a stopped export leaves no stored file behind (its parts go to the file trash)', async () => {
    await respond(survey, 'ada@example.com');
    const id = await startExport({kind: 'responses', formId: survey.id, query: {tz: 'UTC'}});
    const [part] = await db.$queryRaw<{file_id: string}[]>`SELECT file_id FROM intelform_export_parts WHERE export_id = ${id}::uuid`;
    await db.$executeRaw`DELETE FROM responses WHERE form_id = ${survey.id}::uuid`;
    await expectStopped(id);
    const trash = await db.$queryRaw<{file_id: string}[]>`SELECT file_id FROM intelform_file_trash`;
    expect(trash.map(t => t.file_id)).toContain(part!.file_id);
  });

  it('without storage the export fails in words that say how to fix it', async () => {
    await respond(survey, 'ada@example.com');
    storageFailure.code = 'E_STORAGE_NEEDS_PACK';
    const res = await owner.post('/site-api/exports', {kind: 'responses', formId: survey.id, query: {tz: 'UTC'}});
    expect(res.json).toMatchObject({status: 'failed'});
    expect(String((res.json as {error: string}).error)).toMatch(/Storage page/);
    expect(storedFiles.size).toBe(0);
  });

  it('a big export is several files, one per run, each complete: CSVs with their header, ZIPs with their directory', async () => {
    for (let i = 0; i < 5; i++) await respond(survey, `p${i}@example.com`);
    for (let i = 0; i < 3; i++) await respond(other, `q${i}@example.com`);
    const userId = await ownerAccountId();
    const make = async (kind: string, formId: string | null, fileName: string, contentType: string) => {
      const [row] = await db.$queryRaw<{id: string}[]>`
        INSERT INTO intelform_exports (user_id, kind, form_id, params, file_name, content_type)
        VALUES (${userId}, ${kind}, ${formId}::uuid, ${JSON.stringify({query: {}, tz: 'UTC', origin: null})}::jsonb, ${fileName}, ${contentType})
        RETURNING id::text AS id`;
      return row!.id;
    };
    const runAll = async (id: string, partRows: number) => {
      for (let i = 0; i < 40; i++) {
        const [r] = await db.$queryRaw<{status: string}[]>`SELECT status FROM intelform_exports WHERE id = ${id}::uuid`;
        if (r!.status !== 'running') return r!.status;
        await runExportJob(db as never, 'https://shop.example.test/x', {exportId: id}, {send: async () => undefined, partRows});
      }
      return 'stuck';
    };

    const csv = await make('responses', survey.id, 'survey.csv', 'text/csv; charset=utf-8');
    expect(await runAll(csv, 2)).toBe('ready');
    const got = await downloadExport(owner, csv);
    expect(got.files.map(f => f.name)).toEqual(['survey part 1.csv', 'survey part 2.csv', 'survey part 3.csv']);
    const emails = got.files.flatMap(f => {
      const [head, ...rows] = f.text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
      expect(head).toContain('email');
      return rows.map(r => r.match(/p\d@example\.com/)?.[0]);
    });
    expect(emails.sort()).toEqual(['p0@example.com', 'p1@example.com', 'p2@example.com', 'p3@example.com', 'p4@example.com']);

    const zip = await make('all', null, 'responses.zip', 'application/zip');
    expect(await runAll(zip, 2)).toBe('ready');
    const zips = await downloadExport(owner, zip);
    expect(zips.files.length).toBeGreaterThan(1);
    const seen: string[] = [];
    for (const f of zips.files) {
      const entries = unzip(Buffer.from(f.bytes));
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.crcOk, e.name).toBe(true);
        expect(e.text.startsWith('\uFEFF'), e.name).toBe(true);
        seen.push(...(e.text.match(/[pq]\d@example\.com/g) ?? []));
      }
    }
    expect(seen.sort()).toEqual([...['p0', 'p1', 'p2', 'p3', 'p4', 'q0', 'q1', 'q2'].map(x => `${x}@example.com`)]);
  });
});
