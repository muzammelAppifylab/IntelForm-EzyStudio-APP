import {createHmac} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {verifyPassword} from '../../src/platform/auth/password';
import {ifMatchRevision, normalizeDraft, publishCheck, readSettings, readTheme} from '../../src/server/intelform/builder/draft';
import {BuilderError, errorBody, isUniqueViolation, uuidOrNull} from '../../src/server/intelform/builder/errors';
import {othersFrom} from '../../src/server/intelform/builder/presence';
import {mergeSettings, preparePatch, statusAfterSettings} from '../../src/server/intelform/builder/save';
import {
  assertSafeUrl,
  deliveryState,
  generateWebhookSecret,
  readWebhookConfig,
  signWebhook,
  testPayload,
  UnsafeWebhookUrl,
} from '../../src/server/intelform/builder/webhook-core';
import {runDelivery, webhookUrlPolicy} from '../../src/server/intelform/builder/webhook-delivery';
import {config} from '../../src/platform/config';
import {isIpLiteral, isPrivateAddress} from '../../src/server/intelform/webhooks/ssrf';

const field = (id: string, type: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  label,
  required: false,
  props: {},
  ...extra,
});
const draft = (fields: unknown[]) => ({layout: 'all_at_once', fields});

function thrown(fn: () => unknown): BuilderError {
  try {
    fn();
  } catch (err) {
    if (err instanceof BuilderError) return err;
    throw err;
  }
  throw new Error('expected a BuilderError');
}

describe('autosave: drafts', () => {
  it('fills missing field props and screens with defaults', () => {
    const def = normalizeDraft(draft([field('f_abcd1234', 'rating', 'How was it?')]));
    expect(def.fields[0]!.props).not.toEqual({});
    expect(def.endScreen).toBeDefined();
    expect(def.startScreen).toBeDefined();
  });

  it('rejects a broken draft with fields under draft.*', () => {
    const err = thrown(() => normalizeDraft({layout: 'sideways', fields: []}));
    expect(err.status).toBe(422);
    expect(err.code).toBe('invalid_input');
    expect(Object.keys(err.fields ?? {}).some(k => k.startsWith('draft'))).toBe(true);
  });

  it('reads If-Match in its usual spellings', () => {
    expect(ifMatchRevision('"12"')).toBe(12);
    expect(ifMatchRevision('W/"7"')).toBe(7);
    expect(ifMatchRevision('3')).toBe(3);
    expect(ifMatchRevision('*')).toBeNull();
    expect(ifMatchRevision(undefined)).toBeNull();
  });

  it('reads stored settings and themes tolerantly', () => {
    expect(readSettings(null)).toEqual(defaultFormSettings());
    expect(readSettings({closedMessage: 'Shut'}).closedMessage).toBe('Shut');
    expect(readTheme('nonsense')).toBeTruthy();
  });
});

describe('autosave: settings', () => {
  it('hashes a password, never keeps it, and clears it with null', async () => {
    const set = await preparePatch({settings: {password: 'open sesame', closedMessage: 'Shut'}});
    expect(set.passwordHash).toBeTruthy();
    expect(JSON.stringify(set)).not.toContain('open sesame');
    expect((await verifyPassword('open sesame', set.passwordHash!)).ok).toBe(true);
    const merged = mergeSettings(defaultFormSettings(), set.settingsPatch!, set.passwordHash);
    expect(merged.passwordHash).toBe(set.passwordHash);
    expect(merged.closedMessage).toBe('Shut');

    const cleared = await preparePatch({settings: {password: null}});
    expect(cleared.passwordHash).toBeNull();
    expect(mergeSettings(merged, cleared.settingsPatch!, cleared.passwordHash).passwordHash).toBeNull();
  });

  it('merges the webhook key by key and refuses incomplete settings', () => {
    const current = {...defaultFormSettings(), webhook: {enabled: true, url: 'https://hooks.example.com/a', headers: []}};
    expect(mergeSettings(current, {webhook: {enabled: false}}).webhook).toEqual({
      enabled: false,
      url: 'https://hooks.example.com/a',
      headers: [],
    });
    const noUrl = thrown(() => mergeSettings(defaultFormSettings(), {webhook: {enabled: true}}));
    expect(noUrl.fields?.['settings.webhook.url']).toBeTruthy();
    const redirect = thrown(() => mergeSettings(defaultFormSettings(), {afterSubmit: 'redirect'}));
    expect(redirect.fields?.['settings.redirectUrl']).toBeTruthy();
  });

  it('refuses private and plain-http webhook URLs when saving', async () => {
    for (const url of ['https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://localhost/x', 'https://db.internal/x', 'http://hooks.example.com/x']) {
      await expect(preparePatch({settings: {webhook: {url}}}, {policy: {allowHttp: false}})).rejects.toMatchObject({
        status: 422,
        fields: {'settings.webhook.url': [expect.any(String)]},
      });
    }
    const ok = await preparePatch({settings: {webhook: {enabled: true, url: 'https://hooks.example.com/x'}}}, {policy: {allowHttp: false}});
    expect(ok.settingsPatch).toEqual({webhook: {enabled: true, url: 'https://hooks.example.com/x'}});
  });

  it('moves the status with "Close form now"', () => {
    const open = defaultFormSettings();
    const closed = {...open, closed: true};
    expect(statusAfterSettings('live', open, closed, true)).toBe('closed');
    expect(statusAfterSettings('closed', closed, open, true)).toBe('live');
    expect(statusAfterSettings('closed', closed, open, false)).toBe('closed');
    expect(statusAfterSettings('draft', open, closed, false)).toBe('draft');
  });
});

describe('publish checks', () => {
  it('refuses an empty form', () => {
    const r = publishCheck(normalizeDraft(draft([])), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('empty_form');
  });

  it('refuses an invalid stored draft with fields', () => {
    const r = publishCheck({layout: 'sideways', fields: []}, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_input');
  });

  it('lists logic issues', () => {
    const def = normalizeDraft(
      draft([
        field('f_first001', 'short_text', 'First', {
          logic: {action: 'show', match: 'all', conditions: [{field: 'f_later001', op: 'is_not_empty'}]},
        }),
        field('f_later001', 'short_text', 'Later'),
      ])
    );
    const r = publishCheck(def, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('logic_issues');
      const body = errorBody(r.error) as {error: string; issues: {code: string}[]};
      expect(body.error).toBe('logic_issues');
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });

  it('one response per email: blocks until the email question is required, then passes', () => {
    const email = field('f_email001', 'email', 'Email');
    const settings = {onePerEmail: true, onePerEmailFieldId: 'f_email001'};
    const blocked = publishCheck(normalizeDraft(draft([email])), settings);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect((blocked.error.extra!.issues as {code: string}[]).map(i => i.code)).toContain('one_per_email');
    }
    const fixed = publishCheck(normalizeDraft(draft([{...email, required: true}])), settings);
    expect(fixed.ok).toBe(true);
  });
});

describe('webhook URLs', () => {
  it('spots private and local literals', () => {
    for (const host of ['127.0.0.1', '10.0.0.1', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '[::1]', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'ff02::1']) {
      expect(isPrivateAddress(host), host).toBe(true);
    }
    for (const host of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(host), host).toBe(false);
    }
    // A name is not a literal: assertSafeUrl checks names by their suffix instead.
    expect(isIpLiteral('hooks.example.com')).toBe(false);
  });

  it('accepts public https only, with no credentials', () => {
    expect(assertSafeUrl('https://hooks.example.com/x').hostname).toBe('hooks.example.com');
    expect(assertSafeUrl('https://[2606:4700:4700::1111]/x')).toBeTruthy();
    for (const bad of ['ftp://x.example.com', 'not a url', 'https://user:pw@hooks.example.com', 'https://2130706433/', 'https://intranet/x', 'https://printer.local/x']) {
      expect(() => assertSafeUrl(bad), bad).toThrow(UnsafeWebhookUrl);
    }
    expect(() => assertSafeUrl('http://localhost:4000/hook', {allowHttp: true, allowPrivate: true})).not.toThrow();
  });
});

describe('webhook URLs in the deployed Preview (production=false, localDev=false)', () => {
  it('refuses private, loopback, metadata and local-name targets on save and send', async () => {
    const prod = vi.spyOn(config, 'production', 'get').mockReturnValue(false);
    const local = vi.spyOn(config, 'localDev', 'get').mockReturnValue(false);
    try {
      expect(webhookUrlPolicy()).toEqual({allowHttp: true, allowPrivate: false});
      for (const url of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:8080/x', 'http://localhost/x', 'http://db.internal/x', 'http://[::1]/x']) {
        await expect(preparePatch({settings: {webhook: {url}}}), url).rejects.toMatchObject({status: 422});
        const fetchFn = vi.fn();
        const out = await runDelivery(fakeDb(queued({settings: {webhook: {enabled: true, url, headers: []}}})).db, 'id', {fetch: fetchFn as never});
        expect(out?.error, url).toMatch(/private or local|local host names/);
        expect(fetchFn).not.toHaveBeenCalled();
      }
      // Plain http to a public host stays allowed off production.
      await expect(preparePatch({settings: {webhook: {url: 'http://hooks.example.com/x'}}})).resolves.toBeTruthy();
    } finally {
      prod.mockRestore();
      local.mockRestore();
    }
  });
});

describe('webhook signing and config', () => {
  it('signs per Standard Webhooks (HMAC-SHA256 of id.timestamp.body)', async () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const sig = await signWebhook(secret, 'msg_1', 1700000000, '{"a":1}');
    const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update('msg_1.1700000000.{"a":1}').digest('base64');
    expect(sig).toBe(`v1,${expected}`);
  });

  it('drops reserved and broken custom headers', () => {
    const cfg = readWebhookConfig({
      webhook: {
        enabled: true,
        url: ' https://hooks.example.com/x ',
        headers: [
          {key: 'Authorization', value: 'Bearer x'},
          {key: 'Host', value: 'evil'},
          {key: 'webhook-id', value: 'spoof'},
          {key: 'X-Bad', value: 'a\r\nb'},
          {key: 'bad name', value: 'x'},
        ],
      },
    });
    expect(cfg).toEqual({enabled: true, url: 'https://hooks.example.com/x', headers: [['Authorization', 'Bearer x']]});
    expect(readWebhookConfig({webhook: {enabled: true, url: null}}).enabled).toBe(false);
    expect(readWebhookConfig(null)).toEqual({enabled: false, url: null, headers: []});
  });

  it('builds a test payload shaped like a real delivery', () => {
    const def = normalizeDraft(
      draft([field('f_email001', 'email', 'Email'), field('f_sect0001', 'section_break', 'Page 2'), field('f_nps00001', 'nps', 'Score')])
    );
    const p = testPayload({id: 'form-1', title: 'Sign-up', version: 3}, def, new Date('2026-01-02T03:04:05Z'));
    expect(p).toMatchObject({type: 'response.test', test: true, form_id: 'form-1', form_version: 3, response_id: null});
    expect(Object.keys(p.answers)).toEqual(['f_email001', 'f_nps00001']);
    expect(p.answers.f_email001).toEqual({label: 'Email', type: 'email', value: 'sam@example.com'});
    expect(testPayload({id: 'x', title: 'x', version: null}, null).answers).toEqual({});
  });

  it('tells queued, delivered and failed apart', () => {
    expect(deliveryState({statusCode: null, durationMs: null, error: null})).toEqual({pending: true, ok: false});
    expect(deliveryState({statusCode: 204, durationMs: 12, error: null})).toEqual({pending: false, ok: true});
    expect(deliveryState({statusCode: 500, durationMs: 12, error: 'The endpoint answered 500'})).toEqual({pending: false, ok: false});
  });
});

/** A stand-in for the two raw-query methods runDelivery uses. */
function fakeDb(row: Record<string, unknown> | null, secret = generateWebhookSecret()) {
  const updates: unknown[][] = [];
  const db = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM webhook_deliveries d JOIN forms')) return row ? [row] : [];
      if (sql.includes('webhook_secret = COALESCE')) return [{secret}];
      throw new Error(`unexpected query ${sql}`);
    }),
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      updates.push(values);
      return 1;
    }),
  };
  return {db: db as never, updates, secret};
}

const queued = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  form_id: '00000000-0000-4000-8000-00000000f001',
  response_id: null,
  webhook_id: 'msg_test_1',
  url: 'https://hooks.example.com/x',
  payload: {type: 'response.test'},
  is_test: true,
  done: false,
  settings: {webhook: {enabled: true, url: 'https://hooks.example.com/x', headers: [{key: 'X-Token', value: 't'}]}},
  ...over,
});

describe('webhook delivery job', () => {
  it('sends one signed POST, records the outcome, and follows no redirect', async () => {
    const {db, updates, secret} = fakeDb(queued());
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => new Response('thanks', {status: 200}));
    const out = await runDelivery(db, '00000000-0000-4000-8000-0000000000d1', {fetch: fetchFn as never, policy: {allowHttp: false}});
    expect(out).toMatchObject({ok: true, statusCode: 200, error: null});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.com/x');
    expect(init.redirect).toBe('manual');
    const h = init.headers as Record<string, string>;
    expect(h['x-token'] ?? h['X-Token']).toBe('t');
    expect(h['webhook-id']).toBe('msg_test_1');
    const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`msg_test_1.${h['webhook-timestamp']}.${init.body as string}`)
      .digest('base64');
    expect(h['webhook-signature']).toBe(`v1,${expected}`);
    // url, status, duration, body, error
    expect(updates[0]!.slice(1, 2)).toEqual([200]);
    expect(updates[0]![3]).toBe('thanks');
    expect(updates[0]![4]).toBeNull();
  });

  it('records redirects and error answers as failures', async () => {
    const {db} = fakeDb(queued());
    const redirect = await runDelivery(db, 'id', {fetch: (async () => new Response(null, {status: 302, headers: {location: 'https://x'}})) as never});
    expect(redirect).toMatchObject({ok: false, statusCode: 302, error: expect.stringMatching(/Redirects/)});
    const failed = await runDelivery(fakeDb(queued()).db, 'id', {fetch: (async () => new Response('no', {status: 500})) as never});
    expect(failed).toMatchObject({ok: false, statusCode: 500, error: 'The endpoint answered 500'});
    const offline = await runDelivery(fakeDb(queued()).db, 'id', {
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as never,
    });
    expect(offline).toMatchObject({ok: false, statusCode: null, error: 'The endpoint could not be reached'});
  });

  it('is safe to run twice and skips what is gone or switched off', async () => {
    const fetchFn = vi.fn();
    expect(await runDelivery(fakeDb(queued({done: true})).db, 'id', {fetch: fetchFn as never})).toBeNull();
    expect(await runDelivery(fakeDb(null).db, 'id', {fetch: fetchFn as never})).toBeNull();
    const off = await runDelivery(
      fakeDb(queued({is_test: false, response_id: 'r', settings: {webhook: {enabled: false, url: 'https://hooks.example.com/x', headers: []}}})).db,
      'id',
      {fetch: fetchFn as never}
    );
    expect(off).toMatchObject({ok: false, error: 'The webhook is turned off for this form'});
    const unsafe = await runDelivery(fakeDb(queued({settings: {webhook: {enabled: true, url: 'https://10.0.0.5/x', headers: []}}})).db, 'id', {
      fetch: fetchFn as never,
      policy: {allowHttp: false},
    });
    expect(unsafe?.error).toMatch(/private or local/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps only the first 1 KB of the answer', async () => {
    const {db, updates} = fakeDb(queued());
    await runDelivery(db, 'id', {fetch: (async () => new Response('x'.repeat(5000), {status: 200})) as never});
    expect((updates[0]![3] as string).length).toBe(1024);
  });
});

describe('small helpers', () => {
  it('presence: one entry per person, newest first, self marked', () => {
    expect(
      othersFrom(
        [
          {userId: 2, name: 'Ana'},
          {userId: 1, name: 'Me'},
          {userId: 2, name: 'Ana'},
        ],
        1
      )
    ).toEqual([
      {userId: 2, name: 'Ana', self: false},
      {userId: 1, name: 'Me', self: true},
    ]);
  });

  it('uuid params and unique violations', () => {
    expect(uuidOrNull('00000000-0000-4000-8000-00000000F001')).toBe('00000000-0000-4000-8000-00000000f001');
    expect(uuidOrNull('42')).toBeNull();
    expect(isUniqueViolation({code: 'P2002'})).toBe(true);
    expect(isUniqueViolation({code: 'P2010', meta: {code: '23505'}})).toBe(true);
    expect(isUniqueViolation({meta: {driverAdapterError: {cause: {originalCode: '23505'}}}})).toBe(true);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
  });
});
