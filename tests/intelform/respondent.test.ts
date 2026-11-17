import {deflateSync} from 'node:zlib';

import {afterEach, describe, expect, it} from 'vitest';

import {formDefinition} from '../../src/lib/intelform/form/definition';
import {defaultFormSettings} from '../../src/lib/intelform/form/settings';
import {buildSearchText, redirectWithAnswers} from '../../src/server/intelform/respondent/answers';
import {ipHashFor, ipKeyFor, safeEqual} from '../../src/server/intelform/respondent/crypto';
import {parseEvent} from '../../src/server/intelform/respondent/events';
import {isClosed, loadBySlug, parseSettings, SLUG_RE} from '../../src/server/intelform/respondent/load';
import {safeJson} from '../../src/server/intelform/respondent/page';
import {crc32, validatePng} from '../../src/server/intelform/uploads/png';
import {retryAfter, tooMany} from '../../src/server/intelform/respondent/rate-limit';
import {countryOf, deviceOf} from '../../src/server/intelform/respondent/request-meta';
import {
  checkUnlockToken,
  hashBrowserToken,
  readRenderToken,
  RENDER_TOKEN_MAX_AGE_MS,
  renderToken,
  unlockToken,
  UNLOCK_TTL_MS,
} from '../../src/server/intelform/respondent/tokens';
import {setTurnstileFetch, verifyTurnstile} from '../../src/server/intelform/respondent/turnstile';

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const FORM = '00000000-0000-4000-8000-00000000f001';

// --------------------------------------------------------------------------------- tokens --

describe('respondent tokens', () => {
  it('render token: round trip, other form, forged, expired', async () => {
    const now = 1_760_000_000_000;
    const t = await renderToken(SECRET, FORM, now);
    expect(t).toMatch(/^\d+\.[A-Za-z0-9_-]{32}$/);
    expect(await readRenderToken(SECRET, t, FORM, now + 5000)).toBe(now);
    expect(await readRenderToken(SECRET, t, '00000000-0000-4000-8000-00000000f002', now)).toBeNull();
    expect(await readRenderToken('another-secret-0123456789-abcdefghijklmnop', t, FORM, now)).toBeNull();
    expect(await readRenderToken(SECRET, `${now + 1}.${t.split('.')[1]}`, FORM, now)).toBeNull();
    expect(await readRenderToken(SECRET, `${t}.x`, FORM, now)).toBeNull();
    expect(await readRenderToken(SECRET, 'garbage', FORM, now)).toBeNull();
    expect(await readRenderToken(SECRET, t, FORM, now + RENDER_TOKEN_MAX_AGE_MS + 1)).toBe('expired');
  });

  it('unlock token: bound to the password hash and expiry', async () => {
    const now = 1_760_000_000_000;
    const t = await unlockToken(SECRET, FORM, 'hash-a', now);
    expect(await checkUnlockToken(SECRET, t, FORM, 'hash-a', now + 1000)).toBe(true);
    expect(await checkUnlockToken(SECRET, t, FORM, 'hash-b', now + 1000)).toBe(false);
    expect(await checkUnlockToken(SECRET, t, FORM, 'hash-a', now + UNLOCK_TTL_MS + 1)).toBe(false);
    expect(await checkUnlockToken(SECRET, null, FORM, 'hash-a', now)).toBe(false);
    expect(await checkUnlockToken(SECRET, 'x.y', FORM, 'hash-a', now)).toBe(false);
  });

  it('browser token hash is stable, per form, and never the token', async () => {
    const a = await hashBrowserToken(SECRET, FORM, 'tok');
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(await hashBrowserToken(SECRET, FORM, 'tok')).toBe(a);
    expect(await hashBrowserToken(SECRET, '00000000-0000-4000-8000-00000000f002', 'tok')).not.toBe(a);
  });

  it('ip hashes are keyed; rate-limit keys pool an IPv6 /56', async () => {
    const h = await ipHashFor(SECRET, '203.0.113.9');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await ipHashFor(SECRET, null)).toBeNull();
    expect(await ipKeyFor(SECRET, null)).toBe('local');
    expect(await ipKeyFor(SECRET, '2001:db8:1:200::1')).toBe(await ipKeyFor(SECRET, '2001:db8:1:2ff::9'));
    expect(await ipKeyFor(SECRET, '203.0.113.9')).not.toBe(await ipKeyFor(SECRET, '203.0.113.10'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------ png --

function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function ihdr(w: number, h: number, depth = 8, colour = 6): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = depth;
  d[9] = colour;
  return chunk('IHDR', d);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (chunks: Buffer[]) => Buffer.concat([SIG, ...chunks]);
const rows = (w: number, h: number) => Buffer.alloc(h * (1 + w * 4));
const rgba = (w: number, h: number) => [ihdr(w, h), chunk('IDAT', deflateSync(rows(w, h))), chunk('IEND')];

async function reason(buf: Uint8Array): Promise<string> {
  try {
    await validatePng(buf);
    return 'ok';
  } catch (err) {
    return (err as Error).message;
  }
}

const TINY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('validatePng (uploads/png, the live signature check)', () => {
  it('matches the standard CRC-32', () => {
    expect(crc32(Buffer.from('IEND'))).toBe(0xae426082);
  });

  it('accepts canvas-style PNGs', async () => {
    expect(await validatePng(new Uint8Array(TINY))).toEqual({width: 1, height: 1});
    expect(await validatePng(png(rgba(600, 176)))).toEqual({width: 600, height: 176});
    const [head, idat, iend] = rgba(10, 10);
    expect(await reason(png([head!, chunk('sRGB', Buffer.from([0])), chunk('pHYs', Buffer.alloc(9)), idat!, iend!]))).toBe('ok');
  });

  it('rejects payloads, trailing data and bombs', async () => {
    const [head, idat, iend] = rgba(4, 4);
    expect(await reason(Buffer.from('<svg></svg>'.padEnd(80)))).toBe('not a PNG');
    expect(await reason(png([head!, chunk('tEXt', Buffer.from('Comment\0hello')), idat!, iend!]))).toBe('chunk tEXt not allowed');
    expect(await reason(png([head!, idat!, chunk('pHYs', Buffer.alloc(9)), iend!]))).toBe('pHYs after IDAT');
    expect(await reason(Buffer.concat([png([head!, idat!, iend!]), Buffer.from('trailing')]))).toBe('bytes after IEND');
    expect(await reason(png([idat!, head!, iend!]))).toBe('IHDR must come first');
    expect(await reason(png([head!, iend!]))).toBe('missing IDAT');
    const broken = png([head!, idat!, iend!]);
    broken[broken.length - 20]! ^= 0xff;
    expect(await reason(broken)).toMatch(/bad CRC/);
    // zlib data with bytes hidden after the stream
    const z = Buffer.concat([deflateSync(rows(4, 4)), Buffer.from('hidden')]);
    expect(await reason(png([head!, chunk('IDAT', z), iend!]))).toBe('bytes after image data');
    // too short, too long, bad filter
    expect(await reason(png([head!, chunk('IDAT', deflateSync(rows(4, 3))), iend!]))).toBe('image data too short');
    expect(await reason(png([head!, chunk('IDAT', deflateSync(rows(4, 9))), iend!]))).toBe('image data too long');
    const bad = rows(4, 4);
    bad[0] = 9;
    expect(await reason(png([head!, chunk('IDAT', deflateSync(bad)), iend!]))).toBe('bad filter type');
    expect(await reason(png([ihdr(5000, 10), idat!, iend!]))).toBe('bad image size');
    expect(await reason(png([ihdr(4, 4, 8, 7), idat!, iend!]))).toBe('bad colour type or bit depth');
  });
});

// ---------------------------------------------------------------------------- request meta --

describe('request meta', () => {
  it('reads the device and browser, refined by client hints', () => {
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(deviceOf(chromeWin)).toEqual({device: 'desktop', browser: 'Chrome'});
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(deviceOf(iphone)).toEqual({device: 'mobile', browser: 'Safari'});
    expect(deviceOf('', {mobile: '?1'}).device).toBe('mobile');
    expect(deviceOf(chromeWin, {brands: '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99"'}).browser).toBe('Edge');
    expect(deviceOf('')).toEqual({device: null, browser: null});
  });

  it('country only from a two-letter code', () => {
    expect(countryOf('de')).toBe('DE');
    expect(countryOf('XX')).toBeNull();
    expect(countryOf('T1')).toBeNull();
    expect(countryOf('DEU')).toBeNull();
    expect(countryOf(undefined)).toBeNull();
  });
});

// -------------------------------------------------------------------------------- answers --

const DEF = formDefinition.parse({
  layout: 'all_at_once',
  startScreen: {enabled: false, title: '', button: 'Start'},
  endScreen: {title: 'Thanks', message: ''},
  fields: [
    {id: 'f_name', type: 'name', label: 'Your name', required: true, props: {split: true}},
    {id: 'f_email', type: 'email', label: 'Email', required: true},
    {id: 'f_pick', type: 'single_choice', label: 'Pick', props: {options: [{id: 'o_aa', label: 'A'}, {id: 'o_bb', label: 'B'}], other: true}},
    {id: 'f_sign', type: 'signature', label: 'Sign'},
  ],
});

describe('answers', () => {
  it('appends answers to a redirect, never signatures', () => {
    const answers = {f_name: {first: 'Ada', last: 'Lovelace'}, f_email: 'ada@example.com', f_sign: {url: '/__platform/files/file_x/signature.png'}};
    const url = new URL(redirectWithAnswers('https://example.com/thanks?x=1', DEF, answers, true));
    expect(url.searchParams.get('x')).toBe('1');
    expect(url.searchParams.get('f_email')).toBe('ada@example.com');
    expect(url.searchParams.get('f_name')).toContain('Ada');
    expect(url.searchParams.has('f_sign')).toBe(false);
    expect(redirectWithAnswers('https://example.com/thanks', DEF, answers, false)).toBe('https://example.com/thanks');
  });

  it('builds search text from text answers and Other text', () => {
    const text = buildSearchText(DEF.fields, {
      f_name: {first: 'Ada', last: 'Lovelace'},
      f_email: 'ada@example.com',
      f_pick: {other: 'Something else'},
    });
    expect(text.split('\n')).toEqual(['Ada Lovelace', 'ada@example.com', 'Something else']);
  });
});

// ------------------------------------------------------------------------- load / closed --

describe('form state', () => {
  const live = {status: 'live' as const, responseCount: 3, settings: defaultFormSettings()};

  it('isClosed: status, close date, cap', () => {
    expect(isClosed(live)).toBe(false);
    expect(isClosed({...live, status: 'closed'})).toBe(true);
    expect(isClosed({...live, settings: {...live.settings, closeAt: '2000-01-01T00:00:00Z'}})).toBe(true);
    expect(isClosed({...live, settings: {...live.settings, closeAt: '2999-01-01T00:00:00Z'}})).toBe(false);
    expect(isClosed({...live, settings: {...live.settings, responseCap: 3}})).toBe(true);
    expect(isClosed({...live, settings: {...live.settings, responseCap: 4}})).toBe(false);
  });

  it('parseSettings fills defaults and survives bad JSON', () => {
    expect(parseSettings({closedMessage: 'Bye'}).closedMessage).toBe('Bye');
    expect(parseSettings(null)).toEqual(defaultFormSettings());
    expect(parseSettings({responseCap: 'lots'})).toEqual(defaultFormSettings());
  });

  it('slugs: only what a form slug can be (no query for anything else)', async () => {
    expect(SLUG_RE.test('contact-us')).toBe(true);
    expect(SLUG_RE.test('-x')).toBe(false);
    expect(SLUG_RE.test('a'.repeat(61))).toBe(false);
    let queried = false;
    const db = {$queryRaw: async () => ((queried = true), [])} as never;
    expect(await loadBySlug(db, '../etc')).toEqual({kind: 'missing'});
    expect(queried).toBe(false);
  });

  it('loadBySlug: live, moved, draft', async () => {
    const row = {
      id: FORM,
      slug: 'contact-us',
      title: 'Contact',
      status: 'live',
      response_count: 2,
      settings: {},
      published_version_id: '00000000-0000-4000-8000-0000000000a1',
      version: 1,
      definition: DEF,
      theme: {},
      moved: false,
    };
    const dbOf = (rows: unknown[]) => ({$queryRaw: async () => rows}) as never;
    const live = await loadBySlug(dbOf([row]), 'Contact-Us');
    expect(live.kind).toBe('form');
    expect(live.kind === 'form' && live.form.definition.fields.length).toBe(4);
    expect(await loadBySlug(dbOf([{...row, slug: 'new-slug', moved: true}]), 'old-slug')).toEqual({kind: 'moved', slug: 'new-slug'});
    expect(await loadBySlug(dbOf([{...row, slug: 'new-slug', status: 'draft', moved: true}]), 'old-slug')).toEqual({kind: 'missing'});
    expect(await loadBySlug(dbOf([{...row, status: 'draft'}]), 'contact-us')).toEqual({kind: 'missing'});
    expect(await loadBySlug(dbOf([{...row, published_version_id: null, version: null}]), 'contact-us')).toEqual({kind: 'missing'});
    expect(await loadBySlug(dbOf([]), 'contact-us')).toEqual({kind: 'missing'});
  });
});

// ------------------------------------------------------------------------- misc helpers --

describe('helpers', () => {
  it('parseEvent accepts view/start with a uuid session only', () => {
    expect(parseEvent(JSON.stringify({type: 'view', session: '6f1c1d2e-1111-4222-8333-444455556666'})).type).toBe('view');
    expect(() => parseEvent('nope')).toThrow(/JSON/);
    expect(() => parseEvent(JSON.stringify({type: 'submit', session: '6f1c1d2e-1111-4222-8333-444455556666'}))).toThrow(/Unknown event/);
    expect(() => parseEvent(JSON.stringify({type: 'view', session: 'x'}))).toThrow(/Unknown event/);
  });

  it('rate limit: retry-after and the 429', () => {
    expect(retryAfter(60, 60_000 * 10 + 15_000)).toBe(45);
    expect(retryAfter(60, 60_000 * 10)).toBe(60);
    const err = tooMany(30);
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.headers?.['Retry-After']).toBe('30');
  });

  it('safeJson cannot close the script element', () => {
    const s = safeJson({t: '</script><!-- \u2028 & >'});
    expect(s).not.toMatch(/<|>|&|\u2028/);
    expect(JSON.parse(s)).toEqual({t: '</script><!-- \u2028 & >'});
  });
});

// ------------------------------------------------------------------------------ turnstile --

describe('verifyTurnstile', () => {
  afterEach(() => setTurnstileFetch(null));
  const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as typeof fetch;

  it('passes a good token for this host', async () => {
    let sent: URLSearchParams | null = null;
    setTurnstileFetch((async (_url: unknown, init?: RequestInit) => {
      sent = init?.body as URLSearchParams;
      return new Response(JSON.stringify({success: true, action: 'submit', hostname: 'forms.example.com'}));
    }) as typeof fetch);
    await verifyTurnstile('secret-key', 'tok', '203.0.113.9', 'forms.example.com');
    expect(sent!.get('remoteip')).toBe('203.0.113.9');
    expect(sent!.get('response')).toBe('tok');
  });

  it('fails closed', async () => {
    await expect(verifyTurnstile('secret-key', undefined, null, 'h')).rejects.toMatchObject({status: 403, code: 'turnstile_failed'});
    setTurnstileFetch(answer({success: false}));
    await expect(verifyTurnstile('secret-key', 'tok', null, 'h')).rejects.toMatchObject({status: 403});
    setTurnstileFetch(answer({success: true, action: 'login', hostname: 'h'}));
    await expect(verifyTurnstile('secret-key', 'tok', null, 'h')).rejects.toMatchObject({status: 403});
    setTurnstileFetch(answer({success: true, action: 'submit', hostname: 'evil.example'}));
    await expect(verifyTurnstile('secret-key', 'tok', null, 'h')).rejects.toMatchObject({status: 403});
    setTurnstileFetch(answer('not json object'));
    await expect(verifyTurnstile('secret-key', 'tok', null, 'h')).rejects.toMatchObject({status: 503});
    setTurnstileFetch((async () => {
      throw new Error('down');
    }) as typeof fetch);
    await expect(verifyTurnstile('secret-key', 'tok', null, 'h')).rejects.toMatchObject({status: 503});
    // Cloudflare's test secrets answer with example.com
    setTurnstileFetch(answer({success: true, hostname: 'example.com'}));
    await verifyTurnstile('1x0000000000000000000000000000000AA', 'tok', null, 'h');
  });
});
