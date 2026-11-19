import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings, type FormSettings} from '../../src/lib/intelform/form/settings';
import {RespondentError} from '../../src/server/intelform/respondent/errors';
import {setSignatureStorage} from '../../src/server/intelform/respondent/signatures';
import {cleanTtc, handleSubmit, isEmailKeyViolation, MIN_FILL_MS, parseSubmit, type SubmitContext} from '../../src/server/intelform/respondent/submit';
import {renderToken, unlockToken} from '../../src/server/intelform/respondent/tokens';

// The notify domain sends the jobs; here we only check the submit route asks for them, after commit.
const queued: unknown[] = [];
vi.mock('../../src/server/intelform/notify', () => ({
  queueResponseJobs: async (_url: string, r: unknown) => {
    queued.push(r);
    return true;
  },
}));

/**
 * The submit pipeline (submit.ts) against a fake database that answers each statement the way
 * Postgres would for one form. The real SQL runs in the integration tests (TEST_DATABASE_URL).
 */

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const FORM_ID = '00000000-0000-4000-8000-00000000f001';
const VERSION_ID = '00000000-0000-4000-8000-0000000000a1';
const NOW = 1_760_000_000_000;
// A 1×1 grey + alpha PNG (a drawn pad's value; never accepted by the server as is).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// What the browser sends after uploading it (src/respondent/upload.ts).
const SIG = {fileId: 'file_00000000000000000000000001', token: 'ok'};

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [
    {id: 'f_name', type: 'name', label: 'Your name', required: true, props: {split: true}},
    {id: 'f_email', type: 'email', label: 'Email', required: true},
    {id: 'f_more', type: 'yes_no', label: 'Tell us more?'},
    {id: 'f_detail', type: 'long_text', label: 'Details', logic: {action: 'show', match: 'all', conditions: [{field: 'f_more', op: 'is_yes'}]}},
    {id: 'f_sign', type: 'signature', label: 'Sign'},
  ],
});

interface State {
  status: 'live' | 'closed' | 'draft';
  responseCount: number;
  settings: FormSettings;
  inserted: Record<string, unknown>[];
  closedByCap: boolean;
  rateCount: number;
  seenBrowser: boolean;
  seenEmail: boolean;
  failInsert: unknown;
  sql: string[];
}

let state: State;

function makeDb() {
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    state.sql.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
    // The one insert statement: counter, close date and cap re-checked, auto-close, insert.
    if (sql.includes('WITH f AS (') && sql.includes('INSERT INTO responses')) {
      const s = state.settings as {responseCap: number | null; closeAt: string | null};
      if (state.status !== 'live' || (s.closeAt && Date.parse(s.closeAt) <= NOW) || (s.responseCap !== null && state.responseCount >= s.responseCap)) {
        return [];
      }
      // A failed insert undoes the whole statement (nothing counted).
      if (state.failInsert) throw state.failInsert;
      state.responseCount++;
      if (s.responseCap !== null && state.responseCount >= s.responseCap) {
        state.status = 'closed';
        state.closedByCap = true;
      }
      const cols = ['form_version_id', 'answers', 'started_at', 'duration_ms', 'ttc', 'ip_hash', 'country', 'device', 'browser', 'browser_token', 'search_text', 'email_key'];
      state.inserted.push({form_id: values[0], ...Object.fromEntries(cols.map((c, i) => [c, values[i + 2]]))});
      return [{id: '00000000-0000-4000-8000-0000000000r1', submitted_at: new Date(NOW), settings: state.settings, status: state.status}];
    }
    if (sql.includes('FROM forms f LEFT JOIN form_versions')) {
      return [
        {
          id: FORM_ID,
          slug: 'survey',
          title: 'Survey',
          status: state.status,
          response_count: state.responseCount,
          settings: state.settings,
          published_version_id: VERSION_ID,
          version: 1,
          definition: DEF,
          theme: {},
          moved: false,
        },
      ];
    }
    if (sql.includes('INSERT INTO intelform_rate_limits')) return [{count: ++state.rateCount}];
    if (sql.includes('FROM form_versions prev')) return [];
    if (sql.includes('SELECT status, response_count, settings FROM forms')) {
      return [{status: state.status, response_count: state.responseCount, settings: state.settings}];
    }
    if (sql.includes('browser_token =')) return state.seenBrowser ? [{}] : [];
    if (sql.includes('email_key =')) return state.seenEmail ? [{}] : [];
    if (sql.startsWith('\n        UPDATE forms SET response_count') || sql.includes('UPDATE forms SET response_count')) {
      if (state.status !== 'live') return [];
      state.responseCount++;
      return [{response_count: state.responseCount, settings: state.settings}];
    }
    if (sql.includes('INSERT INTO responses')) {
      if (state.failInsert) throw state.failInsert;
      const cols = ['form_id', 'form_version_id', 'answers', 'started_at', 'duration_ms', 'ttc', 'ip_hash', 'country', 'device', 'browser', 'browser_token', 'search_text', 'email_key'];
      state.inserted.push(Object.fromEntries(cols.map((c, i) => [c, values[i]])));
      return [{id: '00000000-0000-4000-8000-0000000000r1', submitted_at: new Date(NOW)}];
    }
    if (sql.includes("SET status = 'closed'")) {
      state.closedByCap = true;
      state.status = 'closed';
      return [{}];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const db = {
    $queryRaw: query,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Roll back the counter if the callback throws, like Postgres would.
      const before = {count: state.responseCount, status: state.status};
      try {
        return await fn({$queryRaw: query});
      } catch (err) {
        state.responseCount = before.count;
        state.status = before.status;
        throw err;
      }
    },
    intelformSettings: {findUnique: async () => null},
  };
  return db as unknown as SubmitContext['db'];
}

function ctx(): SubmitContext {
  return {
    db: makeDb(),
    secret: SECRET,
    requestUrl: 'https://forms.example.com/site-api/public/forms/survey/responses',
    ipKey: 'k',
    meta: async () => ({ipHash: 'a'.repeat(64), country: 'DE', device: 'desktop', browser: 'Chrome'}),
    now: () => NOW,
  };
}

const good = (extra: Record<string, unknown> = {}) => ({f_name: {first: 'Ada', last: 'Lovelace'}, f_email: 'Ada@Example.com', ...extra});

async function body(answers: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    formVersionId: VERSION_ID,
    answers,
    renderToken: await renderToken(SECRET, FORM_ID, NOW - 5000),
    startedAt: NOW - 4000,
    ttc: {f_email: 1200, f_nope: 4},
    ...extra,
  });
}

async function fails(p: Promise<unknown>): Promise<RespondentError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof RespondentError) return err;
    throw err;
  }
  throw new Error('expected an error');
}

const removed: string[][] = [];
let stores = 0;

beforeEach(() => {
  state = {
    status: 'live',
    responseCount: 0,
    settings: defaultFormSettings(),
    inserted: [],
    closedByCap: false,
    rateCount: 0,
    seenBrowser: false,
    seenEmail: false,
    failInsert: null,
    sql: [],
  };
  queued.length = 0;
  removed.length = 0;
  stores = 0;
  // Stands in for claimSignatures (token check, PNG read-back: tests/intelform/uploads.test.ts).
  setSignatureStorage({
    claim: async (_u, input) => {
      const ids: string[] = [];
      for (const f of input.fields) {
        const v = input.answers[f.id] as {fileId?: string; token?: string} | undefined;
        if (f.type !== 'signature' || v === undefined) continue;
        if (v.token !== 'ok' || !v.fileId) return {ok: false, status: 422, code: 'validation_failed', fields: {[f.id]: [input.invalidMessage]}};
        stores++;
        ids.push(v.fileId);
        input.answers[f.id] = {url: `/__platform/files/${v.fileId}/signature.png`};
      }
      return {ok: true, fileIds: ids};
    },
    remove: async (_u, ids) => void removed.push([...ids]),
  });
});
afterEach(() => setSignatureStorage(null));

describe('submit pipeline', () => {
  it('saves a valid response, counts it and asks for the jobs after commit', async () => {
    const r = await handleSubmit(ctx(), 'survey', await body(good({f_sign: SIG}), {browserToken: 'b1'}));
    expect(r).toEqual({ok: true});
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0]!;
    const answers = JSON.parse(String(row.answers));
    expect(answers.f_email).toBe('ada@example.com');
    expect(answers.f_sign).toEqual({url: '/__platform/files/file_00000000000000000000000001/signature.png'});
    expect(JSON.parse(String(row.ttc))).toEqual({f_email: 1200});
    expect(row.duration_ms).toBe(4000);
    expect(row.ip_hash).toBe('a'.repeat(64));
    expect(row.country).toBe('DE');
    expect(String(row.browser_token)).toMatch(/^[0-9a-f]{40}$/);
    expect(row.search_text).toBe('Ada Lovelace\nada@example.com');
    expect(row.email_key).toBeNull();
    expect(state.responseCount).toBe(1);
    // The form, the rate limit, the insert statement (no one-per checks are on): no interactive transaction.
    expect(state.sql).toHaveLength(3);
    expect(queued).toEqual([{formId: FORM_ID, formTitle: 'Survey', responseId: '00000000-0000-4000-8000-0000000000r1', settings: state.settings}]);
  });

  it('drops honeypot hits, too-fast and forged render tokens with a fake success', async () => {
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {hp: 'spam'}))).toEqual({ok: true});
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: await renderToken(SECRET, FORM_ID, NOW - MIN_FILL_MS + 500)}))).toEqual({ok: true});
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: `${NOW}.forgedforgedforgedforgedforged12`}))).toEqual({ok: true});
    expect(state.inserted).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it('asks for a reload when the page has been open over a day', async () => {
    const err = await fails(handleSubmit(ctx(), 'survey', await body(good(), {renderToken: await renderToken(SECRET, FORM_ID, NOW - 25 * 3600_000)})));
    expect(err).toMatchObject({status: 409, code: 'page_expired'});
  });

  it('validates every field on the server, hidden answers included', async () => {
    let err = await fails(handleSubmit(ctx(), 'survey', await body({f_email: 'not-an-email'})));
    expect(err).toMatchObject({status: 422, code: 'validation_failed'});
    expect(Object.keys(err.fields ?? {}).sort()).toEqual(['f_email', 'f_name']);
    err = await fails(handleSubmit(ctx(), 'survey', await body(good({f_detail: 'hidden text'}))));
    expect(err.fields?.f_detail).toBeTruthy();
    err = await fails(handleSubmit(ctx(), 'survey', await body(good({f_sign: {url: 'https://evil.example/x.png'}}))));
    expect(err.fields?.f_sign).toBeTruthy();
    expect(state.inserted).toHaveLength(0);
  });

  it('refuses a signature that is not a claimed upload (raw data URL, bad token)', async () => {
    let err = await fails(handleSubmit(ctx(), 'survey', await body(good({f_sign: {url: PNG}}))));
    expect(err).toMatchObject({status: 422});
    expect(err.fields?.f_sign).toBeTruthy();
    err = await fails(handleSubmit(ctx(), 'survey', await body(good({f_sign: {...SIG, token: 'forged'}}))));
    expect(err).toMatchObject({status: 422});
    expect(err.fields?.f_sign).toBeTruthy();
    expect(stores).toBe(0);
    expect(state.inserted).toHaveLength(0);
  });

  it('refuses closed, scheduled-closed and capped forms', async () => {
    state.status = 'closed';
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 403, code: 'form_closed'});
    state.status = 'live';
    state.settings = {...defaultFormSettings(), closeAt: new Date(NOW - 1000).toISOString()};
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 403, code: 'form_closed'});
    state.settings = {...defaultFormSettings(), responseCap: 2};
    state.responseCount = 2;
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 403});
  });

  it('closes the form when the response reaches the cap', async () => {
    state.settings = {...defaultFormSettings(), responseCap: 1};
    expect(await handleSubmit(ctx(), 'survey', await body(good()))).toEqual({ok: true});
    expect(state.closedByCap).toBe(true);
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({code: 'form_closed'});
  });

  it('needs the unlock token for a password-protected form', async () => {
    state.settings = {...defaultFormSettings(), passwordHash: 'scrypt$v1$x'};
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 401, code: 'locked'});
    const token = await unlockToken(SECRET, FORM_ID, 'scrypt$v1$x', NOW);
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {unlockToken: token}))).toEqual({ok: true});
  });

  it('rate limits 10 a minute per caller and form', async () => {
    state.rateCount = 10;
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 429, code: 'rate_limited'});
  });

  it('one response per browser', async () => {
    state.settings = {...defaultFormSettings(), onePerBrowser: true};
    state.seenBrowser = true;
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good(), {browserToken: 'b1'})))).toMatchObject({status: 409, code: 'already_responded'});
  });

  it('one response per email: known address, missing answer, and a race on the unique key', async () => {
    state.settings = {...defaultFormSettings(), onePerEmail: true, onePerEmailFieldId: 'f_email'};
    state.seenEmail = true;
    let err = await fails(handleSubmit(ctx(), 'survey', await body(good())));
    expect(err).toMatchObject({status: 422});
    expect(err.fields?.f_email).toBeTruthy();

    state.seenEmail = false;
    state.failInsert = Object.assign(new Error('duplicate key value violates unique constraint "responses_email_key"'), {code: 'P2010', meta: {code: '23505'}});
    err = await fails(handleSubmit(ctx(), 'survey', await body(good({f_sign: SIG}))));
    expect(err.fields?.f_email).toBeTruthy();
    expect(removed).toEqual([['file_00000000000000000000000001']]);
    expect(state.responseCount).toBe(0);

    state.failInsert = null;
    await handleSubmit(ctx(), 'survey', await body(good({f_email: 'Ada+news@Example.com'})));
    expect(state.inserted.at(-1)!.email_key).toBe('ada@example.com');
  });

  it('answers with the redirect, answers appended when that is on', async () => {
    state.settings = {...defaultFormSettings(), afterSubmit: 'redirect', redirectUrl: 'https://example.com/done', redirectAppendAnswers: true};
    const r = await handleSubmit(ctx(), 'survey', await body(good()));
    expect(new URL(r.redirectUrl!).searchParams.get('f_email')).toBe('ada@example.com');
  });

  it('refuses an unknown version and a malformed body', async () => {
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good(), {formVersionId: '00000000-0000-4000-8000-0000000000a9'})))).toMatchObject({
      status: 409,
      code: 'version_unknown',
    });
    expect(await fails(handleSubmit(ctx(), 'survey', 'not json'))).toMatchObject({status: 400, code: 'invalid_json'});
    expect(await fails(handleSubmit(ctx(), 'survey', JSON.stringify({answers: {}})))).toMatchObject({status: 400, code: 'invalid_request'});
  });
});

describe('submit helpers', () => {
  it('parseSubmit keeps only the schema', () => {
    expect(() => parseSubmit(JSON.stringify({formVersionId: 'x', answers: {}, renderToken: ''}))).toThrow(RespondentError);
  });

  it('cleanTtc keeps answered fields, rounds and caps', () => {
    expect(cleanTtc({a: 12.6, b: -1, c: 5, d: Infinity}, {a: 1, b: 1, d: 1})).toEqual({a: 13});
    expect(cleanTtc({a: 1e12}, {a: 1})).toEqual({a: 24 * 3600_000});
    expect(cleanTtc(undefined, {})).toBeNull();
  });

  it('isEmailKeyViolation recognises the unique index through Prisma and the socket', () => {
    expect(isEmailKeyViolation({code: 'P2002', meta: {target: ['form_id', 'email_key']}})).toBe(true);
    expect(isEmailKeyViolation({code: 'P2010', meta: {code: '23505', message: 'responses_email_key'}})).toBe(true);
    expect(isEmailKeyViolation({originalCode: '23505', message: 'duplicate key value violates unique constraint "responses_email_key"'})).toBe(true);
    expect(isEmailKeyViolation({code: 'P2002', meta: {target: ['id']}})).toBe(false);
    expect(isEmailKeyViolation(new Error('boom'))).toBe(false);
  });
});
