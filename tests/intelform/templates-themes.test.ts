import {Hono} from 'hono';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {LAYOUTS} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {BUILTIN_TEMPLATES as SHARED_BUILTINS} from '../../src/lib/intelform/form/templates/index';
import {defaultTheme, THEME_PRESETS} from '../../src/lib/intelform/form/theme';
import {
  BUILTIN_TEMPLATE_SUMMARIES,
  BUILTIN_TEMPLATES,
  builtinTemplateId,
  countFields,
  findBuiltinTemplate,
} from '../../src/server/intelform/templates/builtins';
import {
  deleteSavedTemplate,
  listTemplates,
  loadTemplateSource,
  saveFormAsTemplate,
  savedTemplateSlug,
  savedTemplateSummary,
  templateCategories,
  updateSavedTemplate,
} from '../../src/server/intelform/templates/service';
import {isUuid, zodJson} from '../../src/server/intelform/templates/validate';
import {createSavedTheme, deleteSavedTheme, listSavedThemes, savedThemeView} from '../../src/server/intelform/themes/service';

// ---------------------------------------------------------------------------
// Guards stand-in: the routes run as-is, with a fake viewer, permissions and db.
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({permissions: new Set<string>(), db: null as unknown, signedIn: true}));

vi.mock('../../src/platform/guards', async () => {
  const {createMiddleware} = await import('hono/factory');
  return {
    problem: (error: string, message: string) => ({error, message}),
    withViewer: createMiddleware(async (c, next) => {
      c.set('viewer', state.signedIn ? {state: 'user', id: 7, name: 'Ada', email: 'ada@example.com', emailVerified: true} : {state: 'guest', id: null, name: null, email: null, emailVerified: false});
      await next();
    }),
    requireAuth: createMiddleware(async (c, next) => {
      if (c.var.viewer.state !== 'user') return c.json({error: 'signed_out', message: 'Sign in first.'}, 401);
      await next();
    }),
    requirePermission: (codename: string) =>
      createMiddleware(async (c, next) => {
        if (!state.permissions.has(codename)) return c.json({error: 'forbidden', message: 'No'}, 403);
        await next();
      }),
    withDb: createMiddleware(async (c, next) => {
      c.set('db', state.db);
      await next();
    }),
  };
});

const {templatesRoutes} = await import('../../src/server/routes/templates');
const {themesRoutes} = await import('../../src/server/routes/themes');
const {PERMISSIONS} = await import('../../src/server/permissions');

const app = new Hono().route('/site-api/templates', templatesRoutes).route('/site-api/themes', themesRoutes);
const json = (method: string, body: unknown) => ({method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

const SAVED_ID = '3f1b8f7e-2c4a-4b7e-9d1a-5e6f7a8b9c0d';
const savedRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: SAVED_ID,
  slug: 'saved-abc',
  name: 'My template',
  category: 'Saved',
  description: '',
  definition: {layout: 'one_at_a_time', fields: [{type: 'short_text'}, {type: 'section_break'}, {type: 'email'}]},
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  createdBy: {name: 'Ada'},
  ...over,
});

function fakeDb() {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (name: string, result: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args[0]);
      return Promise.resolve(typeof result === 'function' ? (result as (a: unknown) => unknown)(args[0]) : result);
    };
  const db = {
    calls,
    $queryRaw: rec('$queryRaw', [
      {id: SAVED_ID, slug: 'saved-abc', name: 'My template', category: 'Saved', description: '', created_at: new Date('2026-01-02T03:04:05.000Z'), layout: 'one_at_a_time', field_count: 2, created_by: 'Ada'},
    ]),
    template: {
      findMany: rec('template.findMany', [savedRow()]),
      findUnique: rec('template.findUnique', (a: {where: {id?: string; slug?: string}}) =>
        a.where.id === SAVED_ID || a.where.slug === 'saved-abc' ? {name: 'Mine', definition: {}, theme: {}, settings: {}} : null
      ),
      updateMany: rec('template.updateMany', (a: {where: {id: string}}) => ({count: a.where.id === SAVED_ID ? 1 : 0})),
      deleteMany: rec('template.deleteMany', (a: {where: {id: string}}) => ({count: a.where.id === SAVED_ID ? 1 : 0})),
      create: rec('template.create', (a: {data: Record<string, unknown>}) => ({
        id: SAVED_ID,
        slug: a.data.slug,
        name: a.data.name,
        category: a.data.category,
        description: a.data.description,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      })),
    },
    theme: {
      findMany: rec('theme.findMany', [
        {id: SAVED_ID, name: 'Brand', settings: defaultTheme(), createdAt: new Date('2026-02-01T00:00:00.000Z'), createdBy: null},
        {id: 'bad', name: 'Broken', settings: {font: 'Comic Sans'}, createdAt: new Date(), createdBy: null},
      ]),
      create: rec('theme.create', {id: SAVED_ID, createdAt: new Date('2026-02-02T00:00:00.000Z')}),
      deleteMany: rec('theme.deleteMany', (a: {where: {id: string}}) => ({count: a.where.id === SAVED_ID ? 1 : 0})),
    },
  };
  return db;
}
type FakeDb = ReturnType<typeof fakeDb>;
const asDb = (db: FakeDb) => db as unknown as Parameters<typeof listTemplates>[0];

// ---------------------------------------------------------------------------
describe('built-in templates (code, no seeding)', () => {
  it('serves all 10 shared built-ins with fixed, unique uuids', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(SHARED_BUILTINS.length);
    expect(BUILTIN_TEMPLATES).toHaveLength(10);
    const ids = BUILTIN_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every(isUuid)).toBe(true);
    expect(builtinTemplateId(3)).toBe('00000000-0000-4000-8000-0000000b0003');
  });

  it('fills settings with defaults and uses the default theme, as the legacy seed did', () => {
    const lead = findBuiltinTemplate('builtin-lead-capture')!;
    expect(lead.settings).toMatchObject({...defaultFormSettings(), onePerEmail: true, onePerEmailFieldId: 'f_lcemail'});
    expect(lead.theme).toEqual(defaultTheme());
  });

  it('finds by id (any case) or slug', () => {
    const t = BUILTIN_TEMPLATES[4];
    expect(findBuiltinTemplate(t.id)).toBe(t);
    expect(findBuiltinTemplate(t.id.toUpperCase())).toBe(t);
    expect(findBuiltinTemplate(t.slug)).toBe(t);
    expect(findBuiltinTemplate('nope')).toBeUndefined();
    expect(findBuiltinTemplate(null)).toBeUndefined();
  });

  it('summaries are in sortOrder with valid layouts and field counts excluding section breaks', () => {
    expect(BUILTIN_TEMPLATE_SUMMARIES.map(s => s.slug)).toEqual([...SHARED_BUILTINS].sort((a, b) => a.sortOrder - b.sortOrder).map(t => t.slug));
    for (const s of BUILTIN_TEMPLATE_SUMMARIES) {
      expect(s.isBuiltin).toBe(true);
      expect(LAYOUTS).toContain(s.layout);
      expect(s.fieldCount).toBeGreaterThan(0);
      expect(s.createdBy).toBeNull();
    }
    expect(countFields({fields: [{type: 'section_break'}, {type: 'email'}]})).toBe(1);
    expect(countFields(null)).toBe(0);
  });
});

describe('template service', () => {
  it('lists built-ins first, then saved ones, with categories in order', async () => {
    const db = fakeDb();
    const res = await listTemplates(asDb(db));
    expect(res.templates).toHaveLength(11);
    expect(res.templates.slice(0, 10).every(t => t.isBuiltin)).toBe(true);
    expect(res.templates[10]).toEqual({
      id: SAVED_ID,
      slug: 'saved-abc',
      name: 'My template',
      category: 'Saved',
      description: '',
      isBuiltin: false,
      layout: 'one_at_a_time',
      fieldCount: 2,
      createdBy: 'Ada',
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    expect(res.categories.at(-1)).toBe('Saved');
    expect(res.categories[0]).toBe(BUILTIN_TEMPLATE_SUMMARIES[0].category);
    expect(new Set(res.categories).size).toBe(res.categories.length);
  });

  it('copes with a broken saved definition', () => {
    const s = savedTemplateSummary(savedRow({definition: null, createdBy: null}));
    expect(s.layout).toBe('all_at_once');
    expect(s.fieldCount).toBe(0);
    expect(s.createdBy).toBeNull();
    expect(templateCategories([s, s])).toEqual(['Saved']);
  });

  it('refuses to change built-ins and 404s on unknown ids', async () => {
    const db = fakeDb();
    const builtinId = BUILTIN_TEMPLATES[0].id;
    expect(await updateSavedTemplate(asDb(db), builtinId, {name: 'x'})).toMatchObject({ok: false, status: 403, error: 'builtin_template'});
    expect(await deleteSavedTemplate(asDb(db), BUILTIN_TEMPLATES[0].slug)).toMatchObject({ok: false, status: 403});
    expect(await deleteSavedTemplate(asDb(db), 'not-a-uuid')).toMatchObject({ok: false, status: 404});
    expect(await updateSavedTemplate(asDb(db), '11111111-1111-4111-8111-111111111111', {name: 'x'})).toMatchObject({ok: false, status: 404});
    expect(db.calls['template.updateMany']).toHaveLength(1);
  });

  it('renames only what was sent', async () => {
    const db = fakeDb();
    expect(await updateSavedTemplate(asDb(db), SAVED_ID, {name: 'New'})).toEqual({ok: true});
    expect(db.calls['template.updateMany'][0]).toEqual({where: {id: SAVED_ID}, data: {name: 'New'}});
    await updateSavedTemplate(asDb(db), SAVED_ID, {name: 'N', category: 'C', description: ''});
    expect(db.calls['template.updateMany'][1]).toEqual({where: {id: SAVED_ID}, data: {name: 'N', category: 'C', description: ''}});
  });

  it('loads a template source from a built-in (id or slug) or a saved row', async () => {
    const db = fakeDb();
    const b = BUILTIN_TEMPLATES[1];
    expect(await loadTemplateSource(asDb(db), {templateId: b.id})).toEqual({name: b.name, definition: b.definition, theme: b.theme, settings: b.settings});
    expect((await loadTemplateSource(asDb(db), {templateSlug: b.slug}))?.name).toBe(b.name);
    expect(db.calls['template.findUnique']).toBeUndefined();
    expect((await loadTemplateSource(asDb(db), {templateId: SAVED_ID}))?.name).toBe('Mine');
    expect((await loadTemplateSource(asDb(db), {templateSlug: 'saved-abc'}))?.name).toBe('Mine');
    expect(await loadTemplateSource(asDb(db), {templateSlug: 'missing'})).toBeNull();
    expect(await loadTemplateSource(asDb(db), {templateId: 'zzz'})).toBeNull();
    expect(await loadTemplateSource(asDb(db), {})).toBeNull();
  });

  it('saves a form as a template without its private settings', async () => {
    const db = fakeDb();
    const b = BUILTIN_TEMPLATES[0];
    const settings = {...b.settings, passwordHash: 'h', notifyRecipients: [1, 2], closed: true, webhook: {enabled: true, url: 'https://x.test', headers: []}};
    const summary = await saveFormAsTemplate(asDb(db), {title: 'Form A', draft: b.definition, theme: b.theme, settings}, {}, {id: 7, name: 'Ada'});
    const data = (db.calls['template.create'][0] as {data: Record<string, unknown>}).data;
    expect(data).toMatchObject({name: 'Form A', category: 'Saved', description: '', sortOrder: 1000, createdById: 7});
    expect(data.slug).toMatch(/^saved-[a-z0-9]{12}$/);
    expect(data.settings).toMatchObject({passwordHash: null, notifyRecipients: [], closed: false, webhook: {enabled: false, url: null, headers: []}});
    expect(summary).toMatchObject({id: SAVED_ID, name: 'Form A', isBuiltin: false, layout: b.definition.layout, fieldCount: BUILTIN_TEMPLATES[0].fieldCount, createdBy: 'Ada', createdAt: '2026-03-01T00:00:00.000Z'});
    expect(savedTemplateSlug()).not.toBe(savedTemplateSlug());
  });
});

describe('theme service', () => {
  it('lists parseable saved themes only', async () => {
    const db = fakeDb();
    const res = await listSavedThemes(asDb(db));
    expect(res.themes).toEqual([{id: SAVED_ID, name: 'Brand', settings: defaultTheme(), createdBy: null, createdAt: '2026-02-01T00:00:00.000Z'}]);
    expect(db.calls['theme.findMany'][0]).toMatchObject({take: 200});
    expect(savedThemeView({id: 'x', name: 'x', settings: 'nope', createdAt: new Date(), createdBy: null})).toBeNull();
  });

  it('creates and deletes', async () => {
    const db = fakeDb();
    const t = await createSavedTheme(asDb(db), {name: 'Brand', settings: defaultTheme()}, {id: 7, name: 'Ada'});
    expect(t).toEqual({id: SAVED_ID, name: 'Brand', settings: defaultTheme(), createdBy: 'Ada', createdAt: '2026-02-02T00:00:00.000Z'});
    expect(db.calls['theme.create'][0]).toMatchObject({data: {name: 'Brand', createdById: 7}});
    expect(await deleteSavedTheme(asDb(db), SAVED_ID)).toBe(true);
    expect(await deleteSavedTheme(asDb(db), '11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(await deleteSavedTheme(asDb(db), 'junk')).toBe(false);
    expect(db.calls['theme.deleteMany']).toHaveLength(2);
  });
});

describe('routes', () => {
  beforeEach(() => {
    state.db = fakeDb();
    state.signedIn = true;
    state.permissions = new Set([PERMISSIONS.FORM_READ, PERMISSIONS.FORM_WRITE]);
  });

  it('requires sign-in and FORM_READ to list', async () => {
    state.signedIn = false;
    expect((await app.request('/site-api/templates')).status).toBe(401);
    state.signedIn = true;
    state.permissions = new Set();
    expect((await app.request('/site-api/templates')).status).toBe(403);
    expect((await app.request('/site-api/themes')).status).toBe(403);
  });

  it('GET /templates and /themes', async () => {
    const t = await app.request('/site-api/templates');
    expect(t.status).toBe(200);
    expect(((await t.json()) as {templates: unknown[]}).templates).toHaveLength(11);
    const th = await app.request('/site-api/themes');
    expect(((await th.json()) as {themes: unknown[]}).themes).toHaveLength(1);
    const p = await app.request('/site-api/themes/presets');
    expect(((await p.json()) as {presets: unknown[]}).presets).toHaveLength(THEME_PRESETS.length);
  });

  it('viewers (FORM_READ only) cannot change templates or themes', async () => {
    state.permissions = new Set([PERMISSIONS.FORM_READ]);
    expect((await app.request(`/site-api/templates/${SAVED_ID}`, json('PATCH', {name: 'x'}))).status).toBe(403);
    expect((await app.request(`/site-api/templates/${SAVED_ID}`, {method: 'DELETE'})).status).toBe(403);
    expect((await app.request('/site-api/themes', json('POST', {name: 'x', settings: defaultTheme()}))).status).toBe(403);
    expect((await app.request(`/site-api/themes/${SAVED_ID}`, {method: 'DELETE'})).status).toBe(403);
  });

  it('PATCH validates, locks built-ins and renames saved', async () => {
    const bad = await app.request(`/site-api/templates/${SAVED_ID}`, json('PATCH', {name: '  '}));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({error: 'validation_failed', fields: {name: ['Enter a name']}});
    const locked = await app.request(`/site-api/templates/${BUILTIN_TEMPLATES[0].id}`, json('PATCH', {name: 'x'}));
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({error: 'builtin_template'});
    const ok = await app.request(`/site-api/templates/${SAVED_ID}`, json('PATCH', {name: ' Renamed '}));
    expect(ok.status).toBe(200);
    expect((state.db as FakeDb).calls['template.updateMany'][0]).toMatchObject({data: {name: 'Renamed'}});
  });

  it('DELETE templates', async () => {
    expect((await app.request(`/site-api/templates/${SAVED_ID}`, {method: 'DELETE'})).status).toBe(204);
    expect((await app.request('/site-api/templates/11111111-1111-4111-8111-111111111111', {method: 'DELETE'})).status).toBe(404);
    expect((await app.request(`/site-api/templates/${BUILTIN_TEMPLATES[2].id}`, {method: 'DELETE'})).status).toBe(403);
  });

  it('POST and DELETE themes', async () => {
    const bad = await app.request('/site-api/themes', json('POST', {name: 'x', settings: {font: 'Comic Sans'}}));
    expect(bad.status).toBe(422);
    const res = await app.request('/site-api/themes', json('POST', {name: 'Brand', settings: defaultTheme()}));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({id: SAVED_ID, name: 'Brand', createdBy: 'Ada'});
    expect((await app.request(`/site-api/themes/${SAVED_ID}`, {method: 'DELETE'})).status).toBe(204);
    const gone = await app.request('/site-api/themes/junk', {method: 'DELETE'});
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({error: 'not_found', message: 'That theme no longer exists'});
  });
});

describe('zodJson', () => {
  it('answers 422 with field errors, else passes the parsed body', async () => {
    const {z} = await import('zod');
    const a = new Hono().post('/', zodJson(z.object({n: z.number()})), c => c.json(c.req.valid('json')));
    expect((await a.request('/', json('POST', {n: 'x'}))).status).toBe(422);
    expect(await (await a.request('/', json('POST', {n: 2}))).json()).toEqual({n: 2});
  });
});
