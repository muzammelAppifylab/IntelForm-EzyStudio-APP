import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';


import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings, type FormSettings} from '../../src/lib/intelform/form/settings';
import {clearPublicFormCache} from '../../src/server/intelform/respondent/cache';
import {RespondentError} from '../../src/server/intelform/respondent/errors';
import {setSignatureStorage} from '../../src/server/intelform/respondent/signatures';
import {submitInput} from '../../src/lib/intelform/api-public';
import {
  capInitSql,
  cappedInsertSql,
  cappedOutcome,
  cleanTtc,
  gateSql,
  handleSubmit,
  insertOutcome,
  isEmailKeyViolation,
  MIN_FILL_MS,
  parseSubmit,
  gateKeys,
  gateRefusal,
  SUBMIT_BROWSER_LIMIT,
  tokenKey,
  uncappedInsertSql,
  type InsertParams,
  type SubmitContext,
} from '../../src/server/intelform/respondent/submit';
import {renderToken, unlockToken} from '../../src/server/intelform/respondent/tokens';

// Submit never sends a job: it queues the notify work in its insert statement.
vi.mock('../../src/server/intelform/notify', () => ({
  responseNeedsJobs: (s: {notifyOnResponse?: boolean}) => !!s?.notifyOnResponse,
  queueResponseJobs: async () => {
    throw new Error('submit must not send a job');
  },
}));

/**
 * The submit pipeline (submit.ts) against a fake database that answers each statement the way
 * Postgres would for one form. The real SQL runs in the integration tests (TEST_DATABASE_URL:
 * tests/integration/submit-burst.test.ts, tests/integration/form-caps.test.ts). The published
 * form comes from the Site Cache (in memory here): a test that changes the form by hand clears it,
 * as the owner's routes do.
 */

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const FORM_ID = '00000000-0000-4000-8000-00000000f001';
const VERSION_ID = '00000000-0000-4000-8000-0000000000a1';
const NOW = 1_760_000_000_000;
const SID = 'fill-0001-abcdefghijklmnop';
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
  /** Hits per rate-limit key in the current window. */
  rate: Map<string, number>;
  seenBrowser: boolean;
  seenEmail: boolean;
  failInsert: unknown;
  /** submission ids saved on the form (committed). */
  saved: Map<string, string>;
  /** Committed by a parallel request after this one's pre-check read: the statement conflicts. */
  savedLate: Set<string>;
  /** What the read-back after a failed insert finds. */
  savedAnswers: Map<string, string>;
  queued: string[];
  /** The form's form_caps row exists (its `taken` is responseCount, as the triggers keep it). */
  capRow: boolean;
  sql: string[];
  /** Render tokens that saved a response (their done-markers). */
  usedTokens: Set<string>;
  lastClaimed: boolean;
  /** The caller's address is on the block list. */
  blocked: boolean;
  blocks: number;
  siteLimit: number;
}

let state: State;

const INSERT_COLS = ['form_version_id', 'answers', 'started_at', 'duration_ms', 'ttc', 'ip_hash', 'country', 'device', 'browser', 'browser_token', 'search_text', 'email_key', 'submission_id'];

interface Fragment {
  strings: readonly string[];
  values: unknown[];
}
const isFragment = (v: unknown): v is Fragment =>
  typeof v === 'object' && v !== null && Array.isArray((v as Fragment).strings) && Array.isArray((v as Fragment).values);

/** Inlines nested Prisma.sql fragments (by shape: the test and the module may hold two copies of the class). */
function flatten(strings: readonly string[], values: unknown[]): Fragment {
  const outStrings = [strings[0]!];
  const outValues: unknown[] = [];
  values.forEach((v, i) => {
    if (isFragment(v)) {
      const inner = flatten(v.strings, v.values);
      outStrings[outStrings.length - 1] += inner.strings[0]!;
      outStrings.push(...inner.strings.slice(1));
      outValues.push(...inner.values);
      outStrings[outStrings.length - 1] += strings[i + 1]!;
    } else {
      outValues.push(v);
      outStrings.push(strings[i + 1]!);
    }
  });
  return {strings: outStrings, values: outValues};
}

function makeDb() {
  const query = async (first: TemplateStringsArray | {strings: readonly string[]; values: unknown[]}, ...rest: unknown[]) => {
    // Prisma flattens nested fragments: do the same, so the fake sees the statement as sent.
    const {strings, values} = Array.isArray(first) ? flatten(first as readonly string[], rest) : flatten((first as Fragment).strings, (first as Fragment).values);
    const sql = strings.join('?');
    state.sql.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
    const s = state.settings as {responseCap: number | null; closeAt: string | null};
    const openNow = () => state.status === 'live' && !(s.closeAt && Date.parse(s.closeAt) <= NOW);
    const insert = () => {
      const at = values.indexOf(VERSION_ID);
      const row = Object.fromEntries(INSERT_COLS.map((c, i) => [c, values[at + i]]));
      const needsJobs = values[at + INSERT_COLS.length];
      const sid = row.submission_id as string | null;
      if (state.failInsert) throw state.failInsert;
      // The page load's render token: claimed once (the done-marker), or nothing is inserted.
      const used = values.find(v => typeof v === 'string' && v.startsWith('tok:')) as string | undefined;
      if (used && state.usedTokens.has(used)) {
        state.lastClaimed = false;
        return null;
      }
      state.lastClaimed = true;
      if (sid && (state.saved.has(sid) || state.savedLate.has(sid))) return null; // ON CONFLICT DO NOTHING
      if (used) state.usedTokens.add(used);
      const id = `00000000-0000-4000-8000-0000000000r${state.inserted.length + 1}`;
      state.inserted.push({form_id: FORM_ID, ...row});
      state.responseCount++;
      if (sid) state.saved.set(sid, String(row.answers));
      if (needsJobs) state.queued.push(id);
      return id;
    };
    const capOf = () => (typeof s.responseCap === 'number' ? s.responseCap : null);
    // A capped form's insert: ONE statement on its form_caps row.
    if (sql.includes('UPDATE form_caps fc') && sql.includes('INSERT INTO responses')) {
      const sid = values[values.indexOf(VERSION_ID) + INSERT_COLS.length - 1] as string | null;
      const replay = !!sid && state.saved.has(sid);
      const passed = openNow();
      const cap = capOf();
      const none = {id: null, submitted_at: null, closed_now: false, replay};
      if (!passed) return [{passed: false, capped: false, has_row: state.capRow, took: false, ...none}];
      if (cap === null) return [{passed: true, capped: false, has_row: state.capRow, took: false, ...none}];
      if (!state.capRow) return [{passed: true, capped: true, has_row: false, took: false, ...none}];
      const took = state.responseCount < cap && !replay;
      if (!took) return [{passed: true, capped: true, has_row: true, took: false, ...none}];
      const id = insert();
      let closedNow = false;
      if (id && state.responseCount >= cap) {
        state.status = 'closed';
        state.closedByCap = true;
        closedNow = true;
      }
      return [{passed: true, capped: true, has_row: true, took: true, id, submitted_at: id ? new Date(NOW) : null, closed_now: closedNow, replay, claimed: state.lastClaimed}];
    }
    if (sql.includes('INSERT INTO form_caps')) {
      state.capRow = capOf() !== null;
      return state.capRow ? [{form_id: FORM_ID}] : [];
    }
    // An uncapped form's insert.
    if (sql.includes('WITH f AS (') && sql.includes('INSERT INTO responses')) {
      if (!openNow()) return [];
      if (s.responseCap !== null) return [{passed: true, capped: true, id: null, submitted_at: null, closed_now: false, replay: false}];
      state.capRow = false;
      const id = insert();
      return [{passed: true, capped: false, id, submitted_at: id ? new Date(NOW) : null, closed_now: false, replay: false, claimed: state.lastClaimed}];
    }
    // The gate: the block list, the limits, with the password hash, the cap, its exact count,
    // "saved" and "this page load is used". Per-address keys come as (key, window, limit).
    if (sql.includes('INSERT INTO intelform_rate_limits') && sql.includes('intelform_blocked_ips')) {
      const sid = values.find(v => typeof v === 'string' && v.startsWith('fill-')) as string | undefined;
      const used = values.find(v => typeof v === 'string' && v.startsWith('tok:')) as string | undefined;
      const counts: Record<string, number> = {};
      const bump = (key: string) => {
        state.rate.set(key, (state.rate.get(key) ?? 0) + 1);
        counts[key] = state.rate.get(key)!;
      };
      let over = false;
      if (!state.blocked) {
        values.forEach((v, i) => {
          if (typeof v === 'string' && /^respond-[hdb]:/.test(v)) {
            bump(v);
            if (counts[v]! > Number(values[i + 2])) over = true;
          }
        });
        if (!over) for (const v of values) if (typeof v === 'string' && (v.startsWith('respond-f:') || v === 'respond-site')) bump(v);
      }
      if (over) for (const v of values) if (typeof v === 'string' && v.startsWith('strike:')) bump(v);
      return [
        {
          blocked_until: state.blocked ? new Date(NOW + 3600_000) : null,
          ip_over: over,
          counts,
          site_limit: state.siteLimit,
          strikes: over ? (state.rate.get(values.find(v => typeof v === 'string' && v.startsWith('strike:')) as string) ?? 0) : null,
          found: true,
          password_hash: state.settings.passwordHash,
          cap: capOf(),
          responses: capOf() === null ? 0 : state.responseCount,
          saved: !!sid && state.saved.has(sid),
          token_used: !!used && state.usedTokens.has(used),
        },
      ];
    }
    if (sql.includes('INSERT INTO intelform_blocked_ips')) {
      state.blocked = true;
      state.blocks++;
      return [{blocks: state.blocks, expires_at: new Date(NOW + 3600_000), was_active: false}];
    }
    if (sql.includes('AS seen')) return [{seen: state.settings.onePerBrowser && state.seenBrowser, taken: state.seenEmail}];
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
    if (sql.includes('FROM form_versions prev')) return [];
    if (sql.includes('answers::text')) {
      const sid = values.find(v => typeof v === 'string' && state.savedAnswers.has(v)) as string | undefined;
      return sid ? [{answers: state.savedAnswers.get(sid)}] : [];
    }
    if (sql.includes('submission_id =')) return values.some(v => typeof v === 'string' && state.saved.has(v)) ? [{}] : [];
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const db = {
    $queryRaw: query,
    $transaction: async () => {
      throw new Error('submit never opens a transaction');
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
    renderToken: await renderToken(SECRET, FORM_ID, NOW - 5000, 'k'),
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

beforeEach(async () => {
  state = {
    status: 'live',
    responseCount: 0,
    settings: defaultFormSettings(),
    inserted: [],
    closedByCap: false,
    rate: new Map(),
    seenBrowser: false,
    seenEmail: false,
    failInsert: null,
    saved: new Map(),
    savedLate: new Set(),
    savedAnswers: new Map(),
    queued: [],
    capRow: false,
    sql: [],
    usedTokens: new Set(),
    lastClaimed: true,
    blocked: false,
    blocks: 0,
    siteLimit: 300,
  };
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
  await clearPublicFormCache();
});
afterEach(() => setSignatureStorage(null));

describe('submit pipeline', () => {
  it('saves a valid response without locking the form, and sends no job', async () => {
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
    expect(row.submission_id).toBeNull();
    // The form (a cache miss), the gate, the insert statement (no one-per checks): no transaction.
    expect(state.sql).toHaveLength(3);
    expect(state.sql.some(q => q.includes('UPDATE forms') || q.includes('FOR UPDATE') || q.includes('form_caps fc'))).toBe(false);
    // The next submit takes the form from the Site Cache: the gate and the insert only.
    state.sql = [];
    expect(await handleSubmit(ctx(), 'survey', await body(good()))).toEqual({ok: true});
    expect(state.sql).toHaveLength(2);
    // Notifications are off: nothing queued.
    expect(state.queued).toEqual([]);
  });

  it('queues the notify work in the insert statement when the form needs it', async () => {
    state.settings = {...defaultFormSettings(), notifyOnResponse: true};
    expect(await handleSubmit(ctx(), 'survey', await body(good()))).toEqual({ok: true});
    expect(state.queued).toEqual(['00000000-0000-4000-8000-0000000000r1']);
    expect(state.sql).toHaveLength(3);
  });

  it('drops honeypot hits, too-fast and forged render tokens with a fake success', async () => {
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {hp: 'spam'}))).toEqual({ok: true});
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: await renderToken(SECRET, FORM_ID, NOW - MIN_FILL_MS + 500, 'k')}))).toEqual({ok: true});
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: `${NOW}.nonceNONCEnonce12.forgedforgedforgedforgedforged12.forgedforged1234`}))).toEqual({ok: true});
    expect(state.inserted).toHaveLength(0);
    expect(state.queued).toHaveLength(0);
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
    await clearPublicFormCache();
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 403, code: 'form_closed'});
    state.settings = {...defaultFormSettings(), responseCap: 2};
    state.responseCount = 2;
    await clearPublicFormCache();
    const sql = state.sql.length;
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({status: 403});
    // Refused by the gate's exact count: no insert was tried.
    expect(state.sql.slice(sql).some(q => q.includes('INSERT INTO responses'))).toBe(false);
  });

  it('a cached form that is stale about its cap or status: the statements decide', async () => {
    // Cached as uncapped and live; the owner's cap lands without a cache clear.
    expect(await handleSubmit(ctx(), 'survey', await body(good()))).toEqual({ok: true});
    state.settings = {...defaultFormSettings(), responseCap: 1};
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good())))).toMatchObject({code: 'form_closed'});
    // Raised: the uncapped statement says capped, the capped one creates the row, then inserts.
    state.settings = {...defaultFormSettings(), responseCap: 2};
    expect(await handleSubmit(ctx(), 'survey', await body(good()))).toEqual({ok: true});
    expect(state.inserted).toHaveLength(2);
    expect(state.closedByCap).toBe(true);
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

  it('spam protection: per address an hour, per browser a minute, one statement', async () => {
    // A form's own per-address limit (here raised for a class sharing one network).
    state.settings = {...defaultFormSettings(), spamIpPerHour: 12, spamIpPerDay: 50};
    state.rate.set(`respond-h:k:${FORM_ID}`, 11);
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {browserToken: 'b-new'}))).toEqual({ok: true});
    const err = await fails(handleSubmit(ctx(), 'survey', await body(good(), {browserToken: 'b-other'})));
    expect(err).toMatchObject({status: 429, code: 'rate_limited'});
    expect(Number(err.headers?.['Retry-After'])).toBeGreaterThan(60);

    state.rate.clear();
    for (let i = 0; i < SUBMIT_BROWSER_LIMIT; i++) await handleSubmit(ctx(), 'survey', await body(good(), {browserToken: 'b1'}));
    const browser = await fails(handleSubmit(ctx(), 'survey', await body(good(), {browserToken: 'b1'})));
    expect(browser).toMatchObject({status: 429, code: 'rate_limited'});
    expect(browser.headers?.['Retry-After']).toBeTruthy();
  });

  it('spam protection defaults: 5 an hour from one network, then refused, then blocked; nothing is saved', async () => {
    const statuses: (number | 'ok')[] = [];
    for (let i = 0; i < 9; i++) {
      try {
        await handleSubmit(ctx(), 'survey', await body(good()));
        statuses.push('ok');
      } catch (err) {
        statuses.push((err as RespondentError).status);
      }
    }
    expect(statuses).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 429, 429, 429, 429]);
    expect(state.inserted).toHaveLength(5);
    // The third refusal in the hour blocks the address; after that, one probe refuses it.
    expect(state.blocks).toBe(1);
    expect(state.blocked).toBe(true);
    const events: unknown[] = [];
    const blocked = await fails(handleSubmit({...ctx(), abuse: e => void events.push(e)}, 'survey', await body(good())));
    expect(blocked).toMatchObject({status: 429});
    expect(blocked.message).toMatch(/paused/);
  });

  it('spam protection: the form and the site per minute; refused attempts never reach the insert', async () => {
    const events: {kind: string; scope?: string}[] = [];
    const c = () => ({...ctx(), abuse: (e: {kind: string}) => void events.push(e)});
    state.settings = {...defaultFormSettings(), spamFormPerMinute: 2};
    expect(await handleSubmit(c(), 'survey', await body(good()))).toEqual({ok: true});
    expect(await handleSubmit(c(), 'survey', await body(good()))).toEqual({ok: true});
    expect(await fails(handleSubmit(c(), 'survey', await body(good())))).toMatchObject({status: 429, code: 'rate_limited'});
    expect(events).toEqual([{kind: 'limit', formId: FORM_ID, scope: 'form'}]);
    expect(state.inserted).toHaveLength(2);

    state.rate.clear();
    state.settings = defaultFormSettings();
    state.siteLimit = 1;
    expect(await handleSubmit(c(), 'survey', await body(good()))).toEqual({ok: true});
    expect(await fails(handleSubmit(c(), 'survey', await body(good())))).toMatchObject({status: 429});
    expect(events.at(-1)).toEqual({kind: 'limit', formId: FORM_ID, scope: 'site'});
  });

  it('a render token saves ONE response: a second fill from the same page load is asked to reload', async () => {
    const token = await renderToken(SECRET, FORM_ID, NOW - 5000, 'k');
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: token, submissionId: SID}))).toEqual({ok: true});
    // The same fill again (a lost answer): success, nothing new.
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: token, submissionId: SID}))).toEqual({ok: true});
    expect(state.inserted).toHaveLength(1);
    // Another fill with the same page load (a bot replaying it): refused, nothing saved.
    const err = await fails(handleSubmit(ctx(), 'survey', await body(good(), {renderToken: token, submissionId: 'fill-0002-abcdefghijklmnop'})));
    expect(err).toMatchObject({status: 409, code: 'page_expired'});
    expect(state.inserted).toHaveLength(1);
    // A token handed to another address: the visitor's network changed, reload (answers kept).
    const elsewhere = await renderToken(SECRET, FORM_ID, NOW - 5000, 'other-network');
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good(), {renderToken: elsewhere})))).toMatchObject({status: 409, code: 'page_expired'});
    // The minimum time counts from THIS page load.
    const fresh = await renderToken(SECRET, FORM_ID, NOW - 500, 'k');
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {renderToken: fresh}))).toEqual({ok: true});
    expect(state.inserted).toHaveLength(1);
  });

  it('a capped form: refused and blocked attempts take no slot, so a flood cannot close it', async () => {
    state.settings = {...defaultFormSettings(), responseCap: 10};
    for (let i = 0; i < 30; i++) await handleSubmit(ctx(), 'survey', await body(good())).catch(() => undefined);
    expect(state.inserted).toHaveLength(5);
    expect(state.status).toBe('live');
    expect(state.closedByCap).toBe(false);
  });

  it('a retried fill is answered like the first time and saved once', async () => {
    state.settings = {...defaultFormSettings(), notifyOnResponse: true, afterSubmit: 'redirect', redirectUrl: 'https://example.com/done'};
    const first = await handleSubmit(ctx(), 'survey', await body(good({f_sign: SIG}), {submissionId: SID}));
    expect(first).toEqual({ok: true, redirectUrl: 'https://example.com/done'});
    expect(state.inserted[0]!.submission_id).toBe(SID);
    stores = 0;
    // Saved already: found by the pre-check read, before any signature is claimed.
    expect(await handleSubmit(ctx(), 'survey', await body(good({f_sign: SIG}), {submissionId: SID}))).toEqual(first);
    expect(stores).toBe(0);
    expect(state.inserted).toHaveLength(1);
    expect(state.queued).toHaveLength(1);
  });

  it('a retry racing its first try: the unique index refuses it, success, its own files removed', async () => {
    state.savedLate.add(SID);
    expect(await handleSubmit(ctx(), 'survey', await body(good({f_sign: SIG}), {submissionId: SID}))).toEqual({ok: true});
    expect(state.inserted).toHaveLength(0);
    expect(removed).toEqual([['file_00000000000000000000000001']]);
  });

  it('a lost database answer whose insert landed: success, the saved files are kept', async () => {
    state.settings = {...defaultFormSettings(), onePerEmail: true, onePerEmailFieldId: 'f_email'};
    // The pre-check read misses it; the insert's answer is an error; the read-back finds it.
    state.savedAnswers.set(SID, '{"f_sign":{"fileId":"file_00000000000000000000000001"}}');
    state.failInsert = Object.assign(new Error('duplicate key value violates unique constraint "responses_email_key"'), {code: 'P2010', meta: {code: '23505'}});
    expect(await handleSubmit(ctx(), 'survey', await body(good({f_sign: SIG}), {submissionId: SID}))).toEqual({ok: true});
    expect(removed).toEqual([]);
  });

  it('a capped form inserts in ONE statement on its form_caps row; a retry takes no slot', async () => {
    state.settings = {...defaultFormSettings(), responseCap: 2};
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {submissionId: SID}))).toEqual({ok: true});
    // The first capped submit creates the row from the exact count, then runs the statement again.
    expect(state.sql.filter(q => q.includes('INSERT INTO form_caps'))).toHaveLength(1);
    state.sql = [];
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {submissionId: SID}))).toEqual({ok: true});
    // Saved already: the gate says so, nothing else runs.
    expect(state.sql).toHaveLength(1);
    expect(state.inserted).toHaveLength(1);
    expect(state.status).toBe('live');
    // The last slot closes it; that fill retried after closing is still a success.
    const last = 'fill-0002-abcdefghijklmnop';
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {submissionId: last}))).toEqual({ok: true});
    expect(state.closedByCap).toBe(true);
    expect(await handleSubmit(ctx(), 'survey', await body(good(), {submissionId: last}))).toEqual({ok: true});
    expect(await fails(handleSubmit(ctx(), 'survey', await body(good(), {submissionId: 'fill-0003-abcdefghijklmnop'})))).toMatchObject({code: 'form_closed'});
    expect(state.inserted).toHaveLength(2);
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

  it('submitInput takes an optional submissionId of 16–64 url-safe characters', () => {
    const base = {formVersionId: VERSION_ID, answers: {}, renderToken: 't'};
    expect(submitInput.safeParse(base).success).toBe(true);
    expect(submitInput.safeParse({...base, submissionId: 'A-b_c0123456789xyz'}).success).toBe(true);
    expect(submitInput.safeParse({...base, submissionId: 'x'.repeat(64)}).success).toBe(true);
    for (const bad of ['short', 'x'.repeat(65), 'has space 0123456789', 'slash/0123456789abc', 'plus+0123456789abcd', 1234]) {
      expect(submitInput.safeParse({...base, submissionId: bad}).success).toBe(false);
    }
  });

  it('gate keys: per address an hour and a day, the browser when it sent its token, the form, the site', () => {
    const limits = {spamIpPerHour: 5, spamIpPerDay: 20, spamFormPerMinute: 60};
    expect(gateKeys('ip1', FORM_ID, null, limits)).toEqual({
      perAddress: [
        {key: `respond-h:ip1:${FORM_ID}`, window: 3600, limit: 5},
        {key: `respond-d:ip1:${FORM_ID}`, window: 86_400, limit: 20},
      ],
      perForm: {key: `respond-f:${FORM_ID}`, window: 60, limit: 60},
      perSite: {key: 'respond-site', window: 60},
      strike: 'strike:ip1',
    });
    expect(gateKeys('ip1', FORM_ID, 'h1', limits).perAddress[2]).toEqual({key: `respond-b:h1:${FORM_ID}`, window: 60, limit: SUBMIT_BROWSER_LIMIT});
    expect(SUBMIT_BROWSER_LIMIT).toBe(10);
    expect(tokenKey(FORM_ID, 'abc')).toBe(`tok:${FORM_ID}:abc`);
  });

  it('gateRefusal: the block first, then the address, the form, the site', () => {
    const keys = gateKeys('ip1', FORM_ID, null, {spamIpPerHour: 5, spamIpPerDay: 20, spamFormPerMinute: 60});
    const row = {blocked_until: null, ip_over: false, counts: {}, site_limit: 300, strikes: null, found: true, password_hash: null, cap: null, responses: 0, saved: false, token_used: false};
    expect(gateRefusal(row, keys)).toBeNull();
    expect(gateRefusal({...row, blocked_until: new Date(NOW)}, keys)).toEqual({kind: 'blocked', until: new Date(NOW)});
    expect(gateRefusal({...row, counts: {[`respond-h:ip1:${FORM_ID}`]: 6}, strikes: 2}, keys)).toEqual({kind: 'address', window: 3600, strikes: 2});
    expect(gateRefusal({...row, counts: {[`respond-d:ip1:${FORM_ID}`]: 21}, strikes: 1}, keys)).toEqual({kind: 'address', window: 86_400, strikes: 1});
    expect(gateRefusal({...row, counts: {[`respond-f:${FORM_ID}`]: 61}}, keys)).toEqual({kind: 'form'});
    expect(gateRefusal({...row, counts: JSON.stringify({'respond-site': 301})}, keys)).toEqual({kind: 'site'});
  });

  const params = (extra: Partial<InsertParams> = {}): InsertParams => ({
    formId: FORM_ID,
    versionId: VERSION_ID,
    answersJson: '{}',
    startedAt: null,
    durationMs: null,
    ttcJson: null,
    meta: {ipHash: null, country: null, device: null, browser: null} as never,
    browserHash: null,
    search: '',
    emailKey: null,
    submissionId: SID,
    needsJobs: true,
    now: new Date(NOW),
    ...extra,
  });
  const text = (q: {strings: readonly string[]}) => q.strings.join('?').replace(/\s+/g, ' ');

  it('an uncapped form: a plain read of the form row, never written or locked', () => {
    const sql = text(uncappedInsertSql(params()));
    expect(sql).not.toMatch(/UPDATE forms|FOR UPDATE|response_count|form_counts|UPDATE form_caps/);
    expect(sql).toContain("FROM forms WHERE forms.id = ?::uuid AND forms.status = 'live' AND (intelform_try_timestamptz(forms.settings->>'closeAt') IS NULL");
    expect(sql).toContain("coalesce(jsonb_typeof(forms.settings->'responseCap') = 'number', false) AS capped");
    expect(sql).toContain('uncapped AS (SELECT f.id FROM f WHERE NOT f.capped)');
    // A row left from a removed cap goes, so the count trigger never makes a burst queue on it.
    expect(sql).toContain('DELETE FROM form_caps WHERE form_id IN (SELECT id FROM uncapped)');
    expect(sql).toContain(
      'FROM uncapped AS src WHERE NOT EXISTS (SELECT 1 FROM want WHERE want.key IS NOT NULL) OR EXISTS (SELECT 1 FROM tok) ON CONFLICT (form_id, submission_id) WHERE submission_id IS NOT NULL DO NOTHING'
    );
    expect(sql).toContain('INSERT INTO intelform_notify_queue (response_id) SELECT id FROM ins WHERE ?::boolean');
  });

  it('a capped form: one statement whose target row is form_caps, closed only by a real insert', () => {
    const sql = text(cappedInsertSql(params()));
    // The cap re-checked on the row's newest version (EvalPlanQual); a retry never takes a slot.
    expect(sql).toContain('UPDATE form_caps fc SET cap = f.cap FROM f WHERE fc.form_id = f.id AND f.cap IS NOT NULL AND fc.taken < f.cap AND NOT EXISTS (SELECT 1 FROM dup)');
    expect(sql).toContain('dup AS ( SELECT 1 FROM responses r WHERE r.form_id = ?::uuid AND r.submission_id = ?::text LIMIT 1 )');
    expect(sql).toContain(
      'FROM c AS src WHERE NOT EXISTS (SELECT 1 FROM want WHERE want.key IS NOT NULL) OR EXISTS (SELECT 1 FROM tok) ON CONFLICT (form_id, submission_id) WHERE submission_id IS NOT NULL DO NOTHING'
    );
    expect(sql).toContain("UPDATE forms SET status = 'closed', updated_at = now() FROM c WHERE forms.id = c.id AND c.taken + 1 >= c.cap AND EXISTS (SELECT 1 FROM ins)");
    expect(sql).toContain('INSERT INTO intelform_notify_queue');
    // taken is the triggers' to keep: the statement never adds to it.
    expect(sql).not.toMatch(/taken = |FOR UPDATE|response_count|form_counts/);
    const init = text(capInitSql(FORM_ID));
    expect(init).toContain('INSERT INTO form_caps (form_id, cap, taken)');
    expect(init).toContain('FROM form_counts fc WHERE fc.form_id = forms.id');
    expect(init).toContain('ON CONFLICT (form_id) DO NOTHING');
  });

  it('the gate: the block list, the limits and the form reads in one statement', () => {
    const keys = gateKeys('k', FORM_ID, 'h', {spamIpPerHour: 5, spamIpPerDay: 20, spamFormPerMinute: 60});
    const sql = text(gateSql('k', keys, FORM_ID, SID, tokenKey(FORM_ID, 'tid')));
    expect(sql).toContain('SELECT expires_at FROM intelform_blocked_ips WHERE ip_key = ? AND expires_at > now()');
    expect(sql).toContain('INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)');
    // A blocked address writes nothing; the form and site keys count only an address within its limits.
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM blk) AND NOT (SELECT over FROM ip_over)');
    expect(sql).toContain('WHERE (SELECT over FROM ip_over)');
    expect(sql).toContain("FROM (SELECT 1) AS one LEFT JOIN intelform_settings s ON s.id = 1");
    expect(sql).toContain("f.settings->>'passwordHash' AS password_hash");
    expect(sql).toContain("CASE WHEN jsonb_typeof(f.settings->'responseCap') = 'number' THEN (SELECT GREATEST(COALESCE(sum(fc.responses), 0), 0)::int FROM form_counts fc WHERE fc.form_id = f.id) ELSE 0 END AS responses");
    expect(sql).toContain('EXISTS (SELECT 1 FROM responses r WHERE r.form_id = ?::uuid AND r.submission_id = ?)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM intelform_done_markers m WHERE m.key = ? AND m.expires_at > now()) AS token_used');
    const none = text(gateSql('k', keys, FORM_ID, null, null));
    expect(none).toContain('false AS saved');
    expect(none).toContain('false AS token_used');
  });

  it('the insert claims the page load and counts confirmations per address in the same statement', () => {
    const sql = text(uncappedInsertSql(params({usedKey: tokenKey(FORM_ID, 'tid'), confirmIpKey: 'confirm-ip:k'})));
    expect(sql).toContain('INSERT INTO intelform_done_markers (key, expires_at) SELECT want.key');
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM want WHERE want.key IS NOT NULL) OR EXISTS (SELECT 1 FROM tok)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM tok) AS claimed');
    expect(sql).toContain('FROM ins, cip WHERE cip.count > ?::int');
    expect(insertOutcome({passed: true, capped: false, id: null, submitted_at: null, closed_now: false, replay: false, claimed: false})).toEqual({kind: 'token'});
  });

  it('insertOutcome reads the statement row', () => {
    const row = {passed: true, capped: false, id: null, submitted_at: null, closed_now: false, replay: false};
    expect(insertOutcome(undefined)).toEqual({kind: 'closed'});
    expect(insertOutcome({...row, id: 'r1', closed_now: true})).toEqual({kind: 'saved', id: 'r1', closedNow: true});
    expect(insertOutcome({...row, passed: false})).toEqual({kind: 'closed'});
    expect(insertOutcome({...row, passed: false, replay: true})).toEqual({kind: 'duplicate'});
    expect(insertOutcome({...row, capped: true})).toEqual({kind: 'capped'});
    expect(insertOutcome(row)).toEqual({kind: 'duplicate'});
    // Nothing saved and no submission id that could explain it: an error, never a fake success.
    expect(() => insertOutcome(row, false)).toThrow();
  });

  it('cappedOutcome reads the capped statement row', () => {
    const row = {passed: true, capped: true, has_row: true, took: true, id: null, submitted_at: null, closed_now: false, replay: false};
    expect(cappedOutcome(undefined)).toEqual({kind: 'closed'});
    expect(cappedOutcome({...row, id: 'r1', closed_now: true})).toEqual({kind: 'saved', id: 'r1', closedNow: true});
    expect(cappedOutcome({...row, took: false, replay: true})).toEqual({kind: 'duplicate'});
    expect(cappedOutcome({...row, passed: false})).toEqual({kind: 'closed'});
    expect(cappedOutcome({...row, capped: false})).toEqual({kind: 'uncapped'});
    expect(cappedOutcome({...row, has_row: false})).toEqual({kind: 'init'});
    expect(cappedOutcome({...row, took: false})).toEqual({kind: 'closed'});
    // A slot was free and the unique index refused a parallel copy of this fill.
    expect(cappedOutcome(row)).toEqual({kind: 'duplicate'});
    expect(() => cappedOutcome(row, false)).toThrow();
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
