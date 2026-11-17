import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
// Registers the job handlers: locally an export job runs as soon as it is sent.
import '../../src/server/background';
import {unzip} from '../intelform/unzip';
import {Browser, configureEnv, DATABASE_URL, db, ownerSignedIn, resetDatabase, signedIn, userId} from './support/harness';

/**
 * The Responses API (`/site-api/responses/*`) against a real Postgres: who may read and delete,
 * keyset paging, the drawer, CSV, the summary, column prefs, and the response counter.
 */

const FORM = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const MISSING = '00000000-0000-4000-8000-0000000000a9';
const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const fields = [
  {
    id: 'f_email001',
    type: 'email',
    label: 'Email',
    required: false,
    props: {},
  },
  {
    id: 'f_choice01',
    type: 'single_choice',
    label: 'Favourite fruit',
    required: false,
    props: {
      options: [
        {id: 'o_aaaa01', label: 'Apple'},
        {id: 'o_bbbb01', label: 'Banana'},
      ],
    },
  },
  {
    id: 'f_nps00001',
    type: 'nps',
    label: 'Recommend us?',
    required: false,
    props: {},
  },
];
const definition = {
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks!', message: ''},
  fields,
};

async function insertForm(id: string, slug: string, responses: number) {
  const versionId = id.replace(/a(\d)$/, 'b$1');
  const def = JSON.stringify(definition);
  await db.$executeRaw`
    INSERT INTO forms (id, slug, title, status, draft, response_count, last_response_at)
    VALUES (${id}::uuid, ${slug}, ${'Feedback ' + slug}, 'live', ${def}::jsonb, ${responses}, now())`;
  await db.$executeRaw`
    INSERT INTO form_versions (id, form_id, version, definition, theme) VALUES (${versionId}::uuid, ${id}::uuid, 1, ${def}::jsonb, '{}'::jsonb)`;
  await db.$executeRaw`UPDATE forms SET published_version_id = ${versionId}::uuid WHERE id = ${id}::uuid`;
  for (let i = 0; i < responses; i++) {
    const n = (id === FORM ? 0 : 1000) + i + 1;
    const answers = JSON.stringify({
      f_email001: `person${n}@example.com`,
      f_choice01: {option: i % 2 ? 'o_bbbb01' : 'o_aaaa01'},
      f_nps00001: i % 11,
    });
    await db.$executeRaw`
      INSERT INTO responses (id, form_id, form_version_id, answers, submitted_at, duration_ms, search_text)
      VALUES (${rid(n)}::uuid, ${id}::uuid, ${versionId}::uuid, ${answers}::jsonb, now() - make_interval(mins => ${i}), ${1000 * (i + 1)},
        ${`person${n}@example.com`})`;
  }
}

describe.skipIf(!DATABASE_URL)('responses API (integration, real Postgres)', () => {
  let owner: Browser;
  let editor: Browser;
  let viewer: Browser;
  let member: Browser;

  async function setRoles(email: string, ...slugs: string[]) {
    const id = await userId(email);
    const roles = await db.role.findMany({
      where: {slug: {in: slugs}},
      select: {id: true},
    });
    await db.userRole.deleteMany({where: {userId: id}});
    await db.userRole.createMany({
      data: roles.map(role => ({userId: id, roleId: role.id})),
    });
  }

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await ownerSignedIn(app, undefined, '203.0.113.1');
    editor = await signedIn(app, 'editor@example.test', undefined, '203.0.113.2');
    viewer = await signedIn(app, 'viewer@example.test', undefined, '203.0.113.3');
    member = await signedIn(app, 'member@example.test', undefined, '203.0.113.4');
    // The first signed-in request syncs the catalogue (and grants editor / viewer their defaults).
    await owner.get('/site-api/me');
    await setRoles('editor@example.test', 'member', 'editor');
    await setRoles('viewer@example.test', 'member', 'viewer');
    await insertForm(FORM, 'feedback', 60);
    await insertForm(OTHER, 'other', 2);
  });

  const base = `/site-api/responses/forms/${FORM}`;

  it('needs a session and RESPONSE_READ', async () => {
    expect((await new Browser(app).get(`${base}/responses`)).status).toBe(401);
    expect((await member.get(`${base}/responses`)).status).toBe(403);
    expect((await member.get(`${base}/summary`)).status).toBe(403);
    expect((await viewer.get(`${base}/responses`)).status).toBe(200);
  });

  it('pages by keyset, newest first, with the form total', async () => {
    const first = await viewer.get(`${base}/responses`);
    expect(first.status).toBe(200);
    const rows = first.json.rows as {
      id: string;
      cells: Record<string, string>;
    }[];
    expect(rows).toHaveLength(50);
    expect(rows[0]!.id).toBe(rid(1));
    expect(first.json).toMatchObject({
      total: 60,
      formTotal: 60,
      totalCapped: false,
    });
    expect(rows[0]!.cells).toMatchObject({
      f_email001: 'person1@example.com',
      f_choice01: 'Apple',
    });
    const next = await viewer.get(`${base}/responses?cursor=${first.json.nextCursor as string}&page=2`);
    expect((next.json.rows as {id: string}[]).map(r => r.id)).toEqual(Array.from({length: 10}, (_, i) => rid(51 + i)));
    expect(next.json.nextCursor).toBeNull();
    expect((await viewer.get(`${base}/responses?cursor=junk`)).status).toBe(422);
  });

  it('filters, searches and sorts', async () => {
    const apples = await viewer.get(`${base}/responses?filter=f_choice01:o_aaaa01`);
    expect(apples.json.total).toBe(30);
    const both = await viewer.get(`${base}/responses?filter=f_choice01:o_aaaa01&filter=f_choice01:o_bbbb01&filter=f_nps00001:10`);
    expect(both.json.total).toBe(5);
    const search = await viewer.get(`${base}/responses?q=person7@`);
    expect((search.json.rows as {id: string}[]).map(r => r.id)).toEqual([rid(7)]);
    const byNps = await viewer.get(`${base}/responses?sort=f_nps00001&dir=asc`);
    const first = (byNps.json.rows as {cells: Record<string, string>}[])[0]!;
    expect(first.cells.f_nps00001).toBe('0');
    expect((await viewer.get(`${base}/responses?sort=evil;drop`)).status).toBe(422);
    expect((await viewer.get(`${base}/responses?from=2026-02-30`)).status).toBe(422);
  });

  it('opens a response with its neighbours, only within its own form', async () => {
    const d = await viewer.get(`${base}/responses/${rid(2)}`);
    expect(d.status).toBe(200);
    expect(d.json).toMatchObject({
      id: rid(2),
      prevId: rid(1),
      nextId: rid(3),
      formVersion: 1,
    });
    expect((d.json.answers as {label: string; text: string}[])[1]).toMatchObject({label: 'Favourite fruit', text: 'Banana'});
    // A response of another form is not found through this one.
    expect((await viewer.get(`${base}/responses/${rid(1001)}`)).status).toBe(404);
    expect((await viewer.get(`${base}/responses/not-a-uuid`)).status).toBe(404);
    expect((await viewer.get(`/site-api/responses/forms/${MISSING}/responses`)).status).toBe(404);
  });

  it('exports CSV with the filters (a background job, then the download)', async () => {
    const started = await viewer.post('/site-api/exports', {kind: 'responses', formId: FORM, query: {filter: ['f_choice01:o_bbbb01'], tz: 'Europe/Berlin'}});
    expect(started.status).toBe(202);
    expect(started.json).toMatchObject({kind: 'responses', status: 'ready', rows: 30});
    const id = started.json.id as string;
    expect((await viewer.get(`/site-api/exports/${id}`)).json).toMatchObject({status: 'ready'});
    const res = await viewer.get(`/site-api/exports/${id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain('Feedback feedback responses');
    const lines = String(res.json.text).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(31);
    // The body decoder drops the BOM; the unit tests check it is sent.
    expect(lines[0]!.replace(/^﻿/, '')).toBe('Email,Favourite fruit,Recommend us?,Submitted at,Completion time (seconds),Device,Browser,Country,Response ID');
    const pick = await viewer.post('/site-api/exports', {kind: 'responses', formId: FORM, query: {ids: [rid(3), rid(1001)]}});
    const picked = await viewer.get(`/site-api/exports/${pick.json.id as string}/download`);
    expect(String(picked.json.text).split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('summarises', async () => {
    const s = await viewer.get(`${base}/summary?range=7d`);
    expect(s.status).toBe(200);
    expect(s.json.totals).toMatchObject({responses: 60});
    const q = s.json.questions as {
      fieldId: string;
      answered: number;
      data: {kind: string; score?: number};
    }[];
    expect(q.map(x => x.fieldId)).toEqual(['f_email001', 'f_choice01', 'f_nps00001']);
    expect(q[2]!.data.kind).toBe('nps');
    expect((await viewer.get(`${base}/summary?range=custom&from=2026-01-05&to=2026-01-01`)).status).toBe(422);
  });

  it('keeps column prefs per user', async () => {
    expect((await viewer.get(`${base}/responses/prefs`)).json).toEqual({
      columns: null,
    });
    const cols = [
      {id: 'f_email001', visible: false},
      {id: 'f_email001', visible: true},
      {id: 'submitted_at', visible: true},
    ];
    const put = await viewer.request('PUT', `${base}/responses/prefs`, {
      columns: cols,
    });
    expect(put.json).toEqual({columns: [cols[0], cols[2]]});
    expect((await viewer.get(`${base}/responses/prefs`)).json).toEqual({
      columns: [cols[0], cols[2]],
    });
    expect((await editor.get(`${base}/responses/prefs`)).json).toEqual({
      columns: null,
    });
    expect(
      (
        await viewer.request('PUT', `${base}/responses/prefs`, {
          columns: [{id: 'nope', visible: 1}],
        })
      ).status
    ).toBe(422);
  });

  it('deletes with RESPONSE_DELETE and keeps the counter in step', async () => {
    expect((await viewer.delete(`${base}/responses/${rid(1)}`)).status).toBe(403);
    expect((await editor.delete(`${base}/responses/${rid(1)}`)).json).toEqual({deleted: 1});
    expect((await editor.delete(`${base}/responses/${rid(1)}`)).status).toBe(404);
    // Another form's response id is never deleted through this form.
    const bulk = await editor.post(`${base}/responses/bulk-delete`, {
      ids: [rid(2), rid(3), rid(1001)],
    });
    expect(bulk.json).toEqual({deleted: 2});
    const form = await db.form.findUniqueOrThrow({
      where: {id: FORM},
      select: {responseCount: true, lastResponseAt: true},
    });
    expect(form.responseCount).toBe(57);
    const newest = await db.response.findFirstOrThrow({
      where: {formId: FORM},
      orderBy: {submittedAt: 'desc'},
      select: {id: true, submittedAt: true},
    });
    expect(newest.id).toBe(rid(4));
    expect(form.lastResponseAt?.getTime()).toBe(newest.submittedAt.getTime());
    expect(await db.response.count({where: {formId: OTHER}})).toBe(2);
    expect((await editor.post(`${base}/responses/bulk-delete`, {ids: []})).status).toBe(422);
    // The cached summary was cleared by the deletes.
    expect((await viewer.get(`${base}/summary?range=7d`)).json.totals).toMatchObject({responses: 57});
  });

  it('exports every form as a ZIP for app settings holders only', async () => {
    expect((await editor.post('/site-api/exports', {kind: 'all'})).status).toBe(403);
    const started = await owner.post('/site-api/exports', {kind: 'all'});
    expect(started.json).toMatchObject({kind: 'all', status: 'ready'});
    const zip = await owner.get(`/site-api/exports/${started.json.id as string}/download`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    // The parts stay until the hourly sweep, a day later.
    expect(await db.intelformExportPart.count()).toBeGreaterThan(0);
    // The bytes the live export job wrote (exports/builders.ts) read back as a valid ZIP: every
    // record signature, offset and CRC-32 checks out, one CSV per form.
    const parts = await db.intelformExportPart.findMany({
      where: {exportId: started.json.id as string},
      orderBy: {seq: 'asc'},
      select: {data: true},
    });
    const entries = unzip(Buffer.concat(parts.map(p => Buffer.from(p.data))));
    expect(entries.map(e => e.name).sort()).toEqual(['feedback.csv', 'other.csv']);
    for (const e of entries) {
      expect(e.crcOk, e.name).toBe(true);
      expect(e.text.startsWith('﻿'), e.name).toBe(true);
      expect(e.text, e.name).toContain('Favourite fruit');
    }
  });
});
