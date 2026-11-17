import {afterEach, describe, expect, it, vi} from 'vitest';

import {produce, share} from '../../src/portal/intelform/lib/produce';
import {createStore} from '../../src/portal/intelform/lib/store';

/** The browser helpers siteFetch needs aren't here: the api client is tested with a fake. */
const siteFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
vi.mock('../../src/platform/browser', () => ({siteFetch: (...a: Parameters<typeof siteFetch>) => siteFetch(...a)}));
vi.mock('../../src/platform/files-browser', () => ({putFile: vi.fn()}));

const {api, ApiRequestError, firstFieldErrors, parseErrorBody, sitePath} = await import('../../src/portal/intelform/lib/api');
const {checkUpload, patchForm} = await import('../../src/portal/intelform/builder/api');

describe('produce (immer replacement)', () => {
  const base = {
    title: 'A',
    draft: {fields: [{id: 'f1', label: 'One', props: {x: 1}}, {id: 'f2', label: 'Two', props: {x: 2}}]},
    theme: {font: 'Inter'},
  };

  it('returns the same object when the recipe changes nothing', () => {
    expect(produce(base, d => void (d.title = 'A'))).toBe(base);
    expect(produce(base, () => {})).toBe(base);
  });

  it('shares unchanged branches and never mutates the base', () => {
    const next = produce(base, d => void (d.draft.fields[1].label = 'Zwei'));
    expect(next).not.toBe(base);
    expect(next.theme).toBe(base.theme);
    expect(next.draft.fields[0]).toBe(base.draft.fields[0]);
    expect(next.draft.fields[1].props).toBe(base.draft.fields[1].props);
    expect(next.draft.fields[1].label).toBe('Zwei');
    expect(base.draft.fields[1].label).toBe('Two');
  });

  it('a title edit keeps the draft identity (autosave diffs by reference)', () => {
    const next = produce(base, d => void (d.title = 'B'));
    expect(next.draft).toBe(base.draft);
  });

  it('matches moved array items by id', () => {
    const next = produce(base, d => void d.draft.fields.reverse());
    expect(next.draft.fields[0]).toBe(base.draft.fields[1]);
    expect(next.draft.fields[1]).toBe(base.draft.fields[0]);
    expect(next.draft.fields).not.toBe(base.draft.fields);
  });

  it('handles deleted keys and added items', () => {
    const withLogic = {a: {logic: {x: 1}, keep: [1, 2]}};
    const next = produce(withLogic, d => void delete (d.a as {logic?: unknown}).logic);
    expect(next.a).toEqual({keep: [1, 2]});
    expect(next.a.keep).toBe(withLogic.a.keep);
    expect(share([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('mini store', () => {
  it('notifies only on real changes, with the previous state', () => {
    const store = createStore<{n: number; s: string; inc(): void}>((set, get) => ({
      n: 0,
      s: 'a',
      inc: () => set({n: get().n + 1}),
    }));
    const seen: [number, number][] = [];
    const unsub = store.subscribe((s, prev) => seen.push([s.n, prev.n]));
    store.getState().inc();
    store.setState({s: 'a'});
    store.setState(s => ({n: s.n + 1}));
    unsub();
    store.getState().inc();
    expect(seen).toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(store.getState().n).toBe(3);
  });
});

describe('api client', () => {
  afterEach(() => siteFetch.mockReset());

  it('maps legacy /api paths to /site-api', () => {
    expect(sitePath('/api/forms/1')).toBe('/site-api/forms/1');
    expect(sitePath('/site-api/forms')).toBe('/site-api/forms');
    expect(sitePath('/forms')).toBe('/site-api/forms');
  });

  it('reads both error shapes', () => {
    expect(parseErrorBody({error: 'invalid_input', message: 'Bad', fields: {email: 'Enter an email'}})).toEqual({
      code: 'invalid_input',
      message: 'Bad',
      fields: {email: ['Enter an email']},
      requestId: undefined,
    });
    expect(parseErrorBody({error: {code: 'conflict', message: 'Taken', fields: {slug: ['In use']}, requestId: 'r1'}})).toEqual({
      code: 'conflict',
      message: 'Taken',
      fields: {slug: ['In use']},
      requestId: 'r1',
    });
    expect(parseErrorBody(null, 'Nope')).toEqual({code: 'unknown', message: 'Nope'});
  });

  it('sends JSON through siteFetch and throws ApiRequestError on failure', async () => {
    siteFetch.mockResolvedValueOnce(new Response(JSON.stringify({ok: true}), {status: 200}));
    await expect(api('/api/forms', {method: 'POST', body: {title: 'x'}})).resolves.toEqual({ok: true});
    const [url, init] = siteFetch.mock.calls[0];
    expect(url).toBe('/site-api/forms');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"title":"x"}');

    siteFetch.mockResolvedValueOnce(new Response(JSON.stringify({error: 'invalid_input', message: 'Bad', fields: {title: 'Required'}}), {status: 422}));
    const err = (await api('/site-api/forms').catch((e: unknown) => e)) as InstanceType<typeof ApiRequestError>;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(422);
    expect(firstFieldErrors(err)).toEqual({title: 'Required'});

    siteFetch.mockResolvedValueOnce(new Response(null, {status: 204}));
    await expect(api('/site-api/forms/1', {method: 'DELETE'})).resolves.toBeUndefined();

    siteFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/site-api/forms')).rejects.toMatchObject({status: 0, code: 'offline'});
  });

  it('patchForm sends If-Match with the revision', async () => {
    siteFetch.mockResolvedValueOnce(new Response(JSON.stringify({revision: 4}), {status: 200}));
    await expect(patchForm('abc', {title: 'T'}, 3)).resolves.toEqual({revision: 4});
    const [url, init] = siteFetch.mock.calls[0];
    expect(url).toBe('/site-api/forms/abc');
    expect(init?.method).toBe('PATCH');
    expect((init!.headers as Record<string, string>)['If-Match']).toBe('"3"');

    siteFetch.mockResolvedValueOnce(new Response(JSON.stringify({error: {code: 'too_large', message: 'Too big'}}), {status: 413}));
    await expect(patchForm('abc', {title: 'T'}, 4)).rejects.toMatchObject({status: 413, message: 'Too big'});
  });

  it('checks uploads in the browser first', () => {
    expect(checkUpload({type: 'image/png', size: 1000}, 'image')).toBeNull();
    expect(checkUpload({type: 'image/svg+xml', size: 1000}, 'image')).toMatch(/type/);
    expect(checkUpload({type: 'image/svg+xml', size: 1000}, 'logo')).toBeNull();
    expect(checkUpload({type: 'image/png', size: 6 * 1024 * 1024}, 'og')).toMatch(/too large/);
  });
});
