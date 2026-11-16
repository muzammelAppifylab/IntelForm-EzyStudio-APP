import {describe, expect, it, vi} from 'vitest';

import {EXPORT_ALL_PATH, EXPORT_FAILED, fetchAllResponsesZip, zipFileName} from '../../src/portal/intelform/settings/data';
import {OFFLINE_MESSAGE} from '../../src/portal/intelform/lib/api';

describe('Settings → Data: export every response (ZIP)', () => {
  it('asks the server route the Data card links to', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([80, 75, 3, 4]), {headers: {'Content-Type': 'application/zip'}}));
    await fetchAllResponsesZip(fetcher);
    expect(EXPORT_ALL_PATH).toBe('/site-api/responses/export-all.zip');
    expect(fetcher).toHaveBeenCalledWith(EXPORT_ALL_PATH, {credentials: 'same-origin'});
  });

  it('returns the ZIP and the file name the server gave', async () => {
    const fetcher = async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="responses 2026-11-16.zip"; filename*=UTF-8''responses%202026-11-16.zip`,
        },
      });
    const result = await fetchAllResponsesZip(fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe('responses 2026-11-16.zip');
    expect(result.blob.size).toBe(4);
  });

  it('shows the 429 "try again" message instead of downloading an error', async () => {
    const fetcher = async () =>
      Response.json({error: 'rate_limited', message: 'You exported a lot just now. Try again in a few minutes.'}, {status: 429});
    const result = await fetchAllResponsesZip(fetcher);
    expect(result).toEqual({ok: false, status: 429, message: 'You exported a lot just now. Try again in a few minutes.'});
  });

  it('a 403 / 5xx without a readable body falls back to a plain message', async () => {
    const result = await fetchAllResponsesZip(async () => new Response('oops', {status: 500}));
    expect(result).toEqual({ok: false, status: 500, message: EXPORT_FAILED});
    const forbidden = await fetchAllResponsesZip(async () =>
      Response.json({error: 'forbidden', message: 'You don’t have permission to do that.'}, {status: 403})
    );
    expect(forbidden).toMatchObject({ok: false, status: 403, message: 'You don’t have permission to do that.'});
  });

  it('offline: the connection message', async () => {
    const result = await fetchAllResponsesZip(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(result).toEqual({ok: false, status: 0, message: OFFLINE_MESSAGE});
  });

  it('a stream that breaks part way is a failed export, not a partial file', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([80, 75]));
        controller.error(new Error('dropped'));
      },
    });
    const result = await fetchAllResponsesZip(async () => new Response(body, {headers: {'Content-Type': 'application/zip'}}));
    expect(result).toEqual({ok: false, status: 200, message: EXPORT_FAILED});
  });
});

describe('zipFileName', () => {
  it('prefers filename*, decoded', () => {
    expect(zipFileName(`attachment; filename="r_sum_.zip"; filename*=UTF-8''r%C3%A9sum%C3%A9.zip`)).toBe('résumé.zip');
  });
  it('falls back to the quoted, then the bare name', () => {
    expect(zipFileName('attachment; filename="a b.zip"')).toBe('a b.zip');
    expect(zipFileName('attachment; filename=plain.zip')).toBe('plain.zip');
    expect(zipFileName(`attachment; filename*=UTF-8''%E0%A4%A; filename="safe.zip"`)).toBe('safe.zip');
  });
  it('no header: a dated default', () => {
    expect(zipFileName(null, '2026-01-02')).toBe('responses 2026-01-02.zip');
    expect(zipFileName('attachment', '2026-01-02')).toBe('responses 2026-01-02.zip');
  });
});
