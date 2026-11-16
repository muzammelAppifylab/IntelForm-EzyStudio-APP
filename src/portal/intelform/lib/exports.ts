import {useCallback, useRef, useState} from 'react';

import {siteFetch} from '../../../platform/browser';
import {EXPORT_POLL_MS, type ExportStatus, type StartExportInput} from '../../../lib/intelform/api-exports';
import {useToast} from '../../ui';
import {api, errorMessage, OFFLINE_MESSAGE, parseErrorBody} from './api';

/**
 * Exports run as a background job (src/lib/intelform/api-exports.ts): start one, ask how it is
 * going every 1.5 s, then save the finished file. The download goes through `siteFetch` (the
 * editor Preview's gateway drops the cookies a plain link would carry).
 */

export const EXPORTS_PATH = '/site-api/exports';
/** Stop asking after this long; the export keeps running and can be started again. */
const GIVE_UP_MS = 15 * 60 * 1000;

export type ExportOutcome = {ok: true; name: string} | {ok: false; message: string};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

/** Saves a Blob as a file through a temporary object URL. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Starts an export, waits for it and saves the file. Never throws: the outcome says what happened. */
export async function runExport(
  input: StartExportInput,
  deps: {fetcher?: typeof siteFetch; save?: typeof saveBlob; sleep?: (ms: number) => Promise<unknown>; now?: () => number} = {}
): Promise<ExportOutcome> {
  const fetcher = deps.fetcher ?? siteFetch;
  const sleep = deps.sleep ?? wait;
  const now = deps.now ?? Date.now;
  let status: ExportStatus;
  try {
    status = await api<ExportStatus>(EXPORTS_PATH, {method: 'POST', body: input});
    const until = now() + GIVE_UP_MS;
    while (status.status === 'running') {
      if (now() > until) return {ok: false, message: 'The export is taking a long time. Try again later.'};
      await sleep(EXPORT_POLL_MS);
      status = await api<ExportStatus>(`${EXPORTS_PATH}/${encodeURIComponent(status.id)}`);
    }
  } catch (err) {
    return {ok: false, message: errorMessage(err)};
  }
  if (status.status === 'failed') return {ok: false, message: status.error ?? 'The export didn’t finish. Try again.'};

  let res: Response;
  try {
    res = await fetcher(`${EXPORTS_PATH}/${encodeURIComponent(status.id)}/download`, {credentials: 'same-origin'});
  } catch {
    return {ok: false, message: OFFLINE_MESSAGE};
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    return {ok: false, message: parseErrorBody(data, 'The download didn’t start. Try again.').message};
  }
  try {
    (deps.save ?? saveBlob)(await res.blob(), status.fileName);
  } catch {
    return {ok: false, message: 'The download stopped part way. Try again.'};
  }
  return {ok: true, name: status.fileName};
}

/**
 * `run(input)` for a button: `pending` while it runs (one export at a time per screen), a toast
 * when it is saved or why it wasn't.
 */
export function useExport() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const run = useCallback(
    async (input: StartExportInput) => {
      if (running.current) return;
      running.current = true;
      setPending(true);
      toast.info('Preparing your export…');
      try {
        const out = await runExport(input);
        if (out.ok) toast.success(`Exported ${out.name}.`);
        else toast.danger(out.message);
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [toast]
  );
  return {run, pending};
}
