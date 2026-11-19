import {env} from 'cloudflare:workers';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {reportAbusiveIp} from '../../src/server/intelform/abuse/report';

const ORIGIN = 'https://forms.example.com';

describe('abuse: reportAbusiveIp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(env, {SITE_KEY: undefined, SITE_URL: undefined});
  });

  it('sends nothing without a site key (your own computer)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await reportAbusiveIp({ipBlock: '81.2.69.160', reason: 'limits', count: 3})).toEqual({ok: false, reason: 'no_site_key'});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the network to the platform with the site key', async () => {
    Object.assign(env, {SITE_KEY: 'stk_test', SITE_URL: ORIGIN});
    const fetchSpy = vi.fn(async () => new Response('{}', {status: 202}));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await reportAbusiveIp({ipBlock: '2a01:4f8:1:2::/64', reason: 'limits', count: 3})).toEqual({ok: true});
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/site/v1/abuse/ip-blocks`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer stk_test');
    expect(JSON.parse(String(init.body))).toMatchObject({ip: '2a01:4f8:1:2::/64', reason: 'spam', hits: 3});
  });

  it('never throws when the platform is down or refuses', async () => {
    Object.assign(env, {SITE_KEY: 'stk_test', SITE_URL: ORIGIN});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await reportAbusiveIp({ipBlock: '81.2.69.160', reason: 'limits', count: 3})).toEqual({ok: false, reason: 'unreachable'});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 429})));
    expect(await reportAbusiveIp({ipBlock: '81.2.69.160', reason: 'limits', count: 3})).toEqual({ok: false, reason: 'http_429'});
  });
});
