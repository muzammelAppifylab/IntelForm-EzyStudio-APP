import {describe, expect, it} from 'vitest';

import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {
  completionRate,
  countFields,
  decodeCursor,
  encodeCursor,
  FormsError,
  hasTheme,
  ifMatchRevision,
  isUniqueViolation,
  likePattern,
  listQuery,
  mergeSettings,
  normalizeDraft,
  randomSlug,
  readSettings,
  repairOrBlank,
  savedTemplateSlug,
  statusAfterSettings,
  webhookUrlProblem,
} from '../../src/server/intelform/forms/core';
import {Hono} from 'hono';

import {formDraftRoutes} from '../../src/server/intelform/builder/form-routes';
import {formsRoutes} from '../../src/server/routes/forms';

// As src/server/app.ts mounts them: autosave/publish/versions first, then the rest.
const formsApp = new Hono().route('/', formDraftRoutes).route('/', formsRoutes);

const field = (id: string, type: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  label,
  required: false,
  props: {},
  ...extra,
});

const ID = '0b6f8c1e-2f6c-4a8e-9a39-6e4c1f7d2a10';

describe('slugs', () => {
  it('makes 8 random lower-case letters and digits', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = randomSlug();
      expect(s).toMatch(/^[a-z0-9]{8}$/);
      seen.add(s);
    }
    expect(seen.size).toBe(200);
    expect(randomSlug(12)).toMatch(/^[a-z0-9]{12}$/);
    expect(savedTemplateSlug()).toMatch(/^saved-[a-z0-9]{12}$/);
  });

  it('recognises a unique violation from any driver shape', () => {
    expect(isUniqueViolation({code: 'P2002'})).toBe(true);
    expect(isUniqueViolation({code: 'P2010', meta: {code: '23505'}})).toBe(true);
    expect(isUniqueViolation({originalCode: '23505'})).toBe(true);
    expect(isUniqueViolation(new Error('x', {cause: {code: '23505'}}))).toBe(true);
    expect(isUniqueViolation({code: 'P2025'})).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('drafts', () => {
  it('fills missing field props with the type defaults', () => {
    const draft = normalizeDraft({layout: 'all_at_once', fields: [field('f_abcd1234', 'rating', 'How was it?')]});
    expect(draft.fields[0]!.props).not.toEqual({});
    expect(draft.endScreen).toBeDefined();
    expect(draft.startScreen).toBeDefined();
  });

  it('refuses a broken draft with field messages under draft.*', () => {
    try {
      normalizeDraft({layout: 'sideways', fields: []});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormsError);
      const e = err as FormsError;
      expect(e.status).toBe(422);
      expect(e.code).toBe('validation_failed');
      expect(Object.keys(e.fields ?? {}).every(k => k.startsWith('draft'))).toBe(true);
    }
  });

  it('reads a broken stored draft as a blank form instead of failing', () => {
    expect(repairOrBlank('nonsense').fields).toEqual([]);
    expect(repairOrBlank(null).layout).toBe('all_at_once');
  });

  it('counts questions and logic rules, not section breaks', () => {
    const def = normalizeDraft({
      layout: 'section_by_section',
      fields: [
        field('f_aaaa0001', 'short_text', 'A'),
        field('f_sect0001', 'section_break', 'Next'),
        field('f_bbbb0001', 'short_text', 'B', {
          logic: {action: 'show', match: 'all', conditions: [{field: 'f_aaaa0001', op: 'is_not_empty'}]},
        }),
      ],
    });
    expect(countFields(def)).toEqual({fields: 2, logicRules: 1});
  });

  it('treats an empty theme object as "no theme"', () => {
    expect(hasTheme({})).toBe(false);
    expect(hasTheme(null)).toBe(false);
    expect(hasTheme({colors: {}})).toBe(true);
  });
});

describe('If-Match', () => {
  it('reads "12", W/"12" and 12, and ignores anything else', () => {
    expect(ifMatchRevision('"12"')).toBe(12);
    expect(ifMatchRevision('W/"7"')).toBe(7);
    expect(ifMatchRevision('3')).toBe(3);
    expect(ifMatchRevision('*')).toBeNull();
    expect(ifMatchRevision('"abc"')).toBeNull();
    expect(ifMatchRevision(undefined)).toBeNull();
  });
});

describe('settings', () => {
  it('merges only the keys sent, the webhook key by key, and sets or clears the password hash', () => {
    const current = {...defaultFormSettings(), webhook: {enabled: false, url: 'https://example.com/a', headers: []}};
    const merged = mergeSettings(current, {closedMessage: 'Shut', webhook: {enabled: true}}, {set: true, hash: 'scrypt$v1$x'});
    expect(merged.closedMessage).toBe('Shut');
    expect(merged.webhook).toEqual({enabled: true, url: 'https://example.com/a', headers: []});
    expect(merged.passwordHash).toBe('scrypt$v1$x');
    expect(mergeSettings(merged, {}, {set: true, hash: null}).passwordHash).toBeNull();
    expect(mergeSettings(merged, {}, {set: false}).passwordHash).toBe('scrypt$v1$x');
  });

  it('refuses an invalid combination as a 422 under settings.*', () => {
    expect(() => mergeSettings(defaultFormSettings(), {afterSubmit: 'redirect'}, {set: false})).toThrow(FormsError);
    expect(() => mergeSettings(defaultFormSettings(), {webhook: {enabled: true}}, {set: false})).toThrow(FormsError);
  });

  it('moves the status with "Close form now"', () => {
    const open = defaultFormSettings();
    const closed = {...open, closed: true};
    expect(statusAfterSettings({status: 'live', publishedVersionId: ID}, open, closed)).toBe('closed');
    expect(statusAfterSettings({status: 'closed', publishedVersionId: ID}, closed, open)).toBe('live');
    // Never published: unclosing doesn't make it live.
    expect(statusAfterSettings({status: 'closed', publishedVersionId: null}, closed, open)).toBe('closed');
    expect(statusAfterSettings({status: 'draft', publishedVersionId: null}, open, closed)).toBe('draft');
  });

  it('reads an old or broken settings row with defaults', () => {
    expect(readSettings({}).turnstile).toBe(defaultFormSettings().turnstile);
    expect(readSettings('junk')).toEqual(defaultFormSettings());
  });
});

describe('webhook URL', () => {
  it('accepts a public https address', () => {
    expect(webhookUrlProblem('https://hooks.example.com/services/T000')).toBeNull();
  });

  it.each([
    'http://hooks.example.com/x',
    'ftp://x',
    'not a url',
    'https://user:pw@example.com/',
    'https://localhost/x',
    'https://localhost./x',
    'https://db.internal/x',
    'https://printer.local/x',
    'https://127.0.0.1/x',
    'https://10.1.2.3/x',
    'https://172.20.0.1/x',
    'https://192.168.1.1/x',
    'https://169.254.169.254/latest',
    'https://0x7f.1/x',
    'https://2130706433/x',
    'https://[::1]/x',
    'https://[fd00::1]/x',
    'https://[::ffff:10.0.0.1]/x',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('refuses %s', url => {
    expect(webhookUrlProblem(url)).not.toBeNull();
  });
});

describe('the list query and its keyset cursor', () => {
  it('falls back to the defaults on bad values', () => {
    expect(listQuery.parse({})).toEqual({status: 'all', sort: 'updated'});
    expect(listQuery.parse({status: 'gone', sort: 'random', q: '  zeta '})).toEqual({status: 'all', sort: 'updated', q: 'zeta'});
  });

  it('round-trips each sort order', () => {
    const row = {
      id: ID,
      title: 'Zeta Poll',
      responseCount: 4,
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
      updatedAt: new Date('2026-02-03T04:05:06.789Z'),
    };
    expect(decodeCursor(encodeCursor('updated', 1, row), 'updated')).toEqual({sort: 'updated', page: 1, at: row.updatedAt, id: ID});
    expect(decodeCursor(encodeCursor('created', 2, row), 'created')).toEqual({sort: 'created', page: 2, at: row.createdAt, id: ID});
    expect(decodeCursor(encodeCursor('title', 3, row), 'title')).toEqual({sort: 'title', page: 3, title: 'zeta poll', id: ID});
    expect(decodeCursor(encodeCursor('responses', 1, row), 'responses')).toEqual({
      sort: 'responses',
      page: 1,
      count: 4,
      at: row.updatedAt,
      id: ID,
    });
  });

  it('keeps non-ASCII titles intact', () => {
    const row = {id: ID, title: 'Ümfrage — 春', responseCount: 0, createdAt: new Date(), updatedAt: new Date()};
    expect(decodeCursor(encodeCursor('title', 1, row), 'title')).toMatchObject({title: 'ümfrage — 春'});
  });

  it('ignores a cursor made for another sort, or a tampered one', () => {
    const row = {id: ID, title: 'A', responseCount: 0, createdAt: new Date(), updatedAt: new Date()};
    expect(decodeCursor(encodeCursor('updated', 1, row), 'title')).toBeNull();
    expect(decodeCursor('!!!', 'updated')).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(['updated', 1, 'yesterday', ID])), 'updated')).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(['updated', 1, '2026-01-01T00:00:00.000Z', "1' OR 1=1"])), 'updated')).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(['responses', 1, -1, '2026-01-01T00:00:00.000Z', ID])), 'responses')).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(['updated', 0, '2026-01-01T00:00:00.000Z', ID])), 'updated')).toBeNull();
    expect(decodeCursor(undefined, 'updated')).toBeNull();
  });

  it('makes % and _ literal in search', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b\\c')).toBe('%a\\_b\\\\c%');
  });

  it('computes the completion rate, capped at 1', () => {
    expect(completionRate(1, 4)).toBe(0.25);
    expect(completionRate(5, 4)).toBe(1);
    expect(completionRate(3, 0)).toBeNull();
  });
});

describe('route validators (answered before sign-in or the database)', () => {
  const send = (method: string, path: string, body?: unknown) =>
    formsApp.request(path, {
      method,
      headers: body === undefined ? {} : {'content-type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('404s an id that is not a form id', async () => {
    for (const [method, path] of [
      ['GET', '/not-a-uuid'],
      ['POST', '/x/close'],
      ['POST', '/x/reopen'],
      ['POST', '/x/duplicate'],
    ] as const) {
      const res = await send(method, path);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toMatchObject({error: 'not_found'});
    }
  });

  it('refuses bad create, autosave and delete bodies with field messages', async () => {
    const create = await send('POST', '/', {title: ''});
    expect(create.status).toBe(422);
    expect(((await create.json()) as {fields: Record<string, string[]>}).fields.title).toBeDefined();

    const serverOnly = await send('PATCH', `/${ID}`, {settings: {passwordHash: 'x'}});
    expect(serverOnly.status).toBe(422);
    const shortPassword = await send('PATCH', `/${ID}`, {settings: {password: '1234567'}});
    expect(shortPassword.status).toBe(422);
    const badSlug = await send('PATCH', `/${ID}`, {slug: 'Not a slug!'});
    expect(badSlug.status).toBe(422);
    const unknownKey = await send('PATCH', `/${ID}`, {language: 'de'});
    expect(unknownKey.status).toBe(422);
    const legacyLabels = await send('PATCH', `/${ID}`, {settings: {labels: {submit: 'Senden'}}});
    expect(legacyLabels.status).toBe(422);

    const noConfirm = await send('DELETE', `/${ID}`);
    expect(noConfirm.status).toBe(422);
    expect(((await noConfirm.json()) as {fields: Record<string, string[]>}).fields.confirmTitle).toBeDefined();

    const badView = await send('PATCH', '/prefs/view', {view: 'table'});
    expect(badView.status).toBe(422);
  });
});
