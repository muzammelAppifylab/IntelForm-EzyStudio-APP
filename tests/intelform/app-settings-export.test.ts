import {describe, expect, it, vi} from 'vitest';

/** The browser helpers siteFetch needs aren't here: exports are tested against a fake server. */
const siteFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
vi.mock('../../src/platform/browser', () => ({siteFetch: (...a: Parameters<typeof siteFetch>) => siteFetch(...a)}));

const {runExport, resumeExport, EXPORTS_PATH} = await import('../../src/portal/intelform/lib/exports');
const {OFFLINE_MESSAGE} = await import('../../src/portal/intelform/lib/api');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const status = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  kind: 'all',
  status: 'running',
  rows: 0,
  fileName: 'responses 2026-11-16.zip',
  error: null,
  createdAt: '2026-11-16T00:00:00.000Z',
  ...over,
});

describe('exports (a background job: start, wait, download)', () => {
  it('starts the export, asks until it is ready, then saves the file under its name', async () => {
    siteFetch.mockReset();
    const answers = [json(status(), 202), json(status()), json(status({status: 'ready', rows: 12}))];
    siteFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).endsWith('/download') ? new Response(new Uint8Array([80, 75, 3, 4])) : answers.shift()!
    );
    const save = vi.fn();
    const sleep = vi.fn(async () => undefined);
    const out = await runExport({kind: 'all'}, {save, sleep});
    expect(out).toEqual({ok: true, name: 'responses 2026-11-16.zip'});
    const calls = siteFetch.mock.calls.map(c => [String(c[0]), (c[1] as RequestInit | undefined)?.method ?? 'GET']);
    expect(calls[0]).toEqual([EXPORTS_PATH, 'POST']);
    expect(calls[1]).toEqual([`${EXPORTS_PATH}/e1`, 'GET']);
    expect(calls.at(-1)).toEqual([`${EXPORTS_PATH}/e1/download`, 'GET']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'responses 2026-11-16.zip');
    expect((save.mock.calls[0]![0] as Blob).size).toBe(4);
  });

  it('shows why an export did not finish, and the 429 "try again" message', async () => {
    siteFetch.mockReset();
    siteFetch.mockResolvedValueOnce(json(status({status: 'failed', error: 'This export is too large for one ZIP file.'}), 202));
    expect(await runExport({kind: 'all'}, {save: vi.fn()})).toEqual({ok: false, message: 'This export is too large for one ZIP file.', gone: true});
    siteFetch.mockResolvedValueOnce(json({error: 'rate_limited', message: 'You exported a lot just now. Try again in a few minutes.'}, 429));
    expect(await runExport({kind: 'all'}, {save: vi.fn()})).toEqual({
      ok: false,
      message: 'You exported a lot just now. Try again in a few minutes.',
    });
  });

  it('offline: the connection message', async () => {
    siteFetch.mockReset();
    siteFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await runExport({kind: 'contacts', query: {}}, {save: vi.fn()})).toEqual({ok: false, message: OFFLINE_MESSAGE});
  });

  it('a download that breaks part way is a failed export, not a partial file', async () => {
    siteFetch.mockReset();
    siteFetch.mockResolvedValueOnce(json(status({status: 'ready'}), 202));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.error(new Error('reset'));
      },
    });
    siteFetch.mockResolvedValueOnce(new Response(body));
    const save = vi.fn();
    const out = await runExport({kind: 'responses', formId: '00000000-0000-4000-8000-000000000001', query: {}}, {save});
    expect(out.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('never gives up on a running export (most of an hour), rides out dropped asks, and reports progress', async () => {
    siteFetch.mockReset();
    let clock = 0;
    let asks = 0;
    siteFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/download')) return new Response(new Uint8Array([1, 2]));
      asks++;
      if (asks === 1) return json(status(), 202);
      if (asks % 50 === 0) throw new TypeError('Failed to fetch'); // a dropped connection now and then
      return json(asks > 800 ? status({status: 'ready', rows: 1_000_000}) : status({rows: asks * 1000}));
    });
    const progress: number[] = [];
    const save = vi.fn();
    const out = await runExport(
      {kind: 'all'},
      {save, sleep: async ms => void (clock += ms as number), now: () => clock, onProgress: s => progress.push(s.rows), onStarted: vi.fn()}
    );
    expect(out).toEqual({ok: true, name: 'responses 2026-11-16.zip'});
    expect(clock).toBeGreaterThan(50 * 60 * 1000); // well past the old 15-minute give-up
    expect(progress.at(-1)).toBeGreaterThan(700_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('stops asking after many failed asks in a row, saying the export keeps running', async () => {
    siteFetch.mockReset();
    siteFetch.mockResolvedValueOnce(json(status(), 202));
    siteFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const out = await runExport({kind: 'all'}, {save: vi.fn(), sleep: async () => undefined});
    expect(out).toMatchObject({ok: false, message: expect.stringMatching(/keeps running/)});
  });

  it('a page opened again picks up the export and saves it; a swept one is forgotten quietly', async () => {
    siteFetch.mockReset();
    const answers = [json(status({rows: 10})), json(status({status: 'ready', rows: 20}))];
    siteFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).endsWith('/download') ? new Response(new Uint8Array([1])) : answers.shift()!
    );
    const save = vi.fn();
    expect(await resumeExport('e1', {save, sleep: async () => undefined})).toEqual({ok: true, name: 'responses 2026-11-16.zip'});
    expect(String(siteFetch.mock.calls[0]![0])).toBe(`${EXPORTS_PATH}/e1`);
    siteFetch.mockReset();
    siteFetch.mockResolvedValueOnce(json({error: 'not_found', message: 'That export no longer exists. Start it again.'}, 404));
    expect(await resumeExport('e1', {save})).toEqual({ok: false, message: '', gone: true, quiet: true});
  });
});
