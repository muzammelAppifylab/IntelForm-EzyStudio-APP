import {useCallback, useEffect, useRef, useState} from 'react';

import {siteFetch} from '../../../platform/browser';
import {EXPORT_POLL_MS, type ExportStatus, type StartExportInput} from '../../../lib/intelform/api-exports';
import {useToast} from '../../ui';
import {api, ApiRequestError, errorMessage, OFFLINE_MESSAGE, parseErrorBody} from './api';

/**
 * Exports run as a background job (src/lib/intelform/api-exports.ts): start one, ask how it is
 * going every 1.5 s, then save the finished file. The download goes through `siteFetch` (the
 * editor Preview's gateway drops the cookies a plain link would carry).
 *
 * A big export can take a long while: the page never gives up on a running one. It keeps asking
 * (slower after a few minutes), shows how many rows are written, and rides out a few failed
 * asks (a dropped connection). With a `scope`, the running export's id is remembered in this
 * browser, so a page opened again (or reloaded) picks it up and saves the file when it is ready.
 */

export const EXPORTS_PATH = '/site-api/exports';
/** After this long the page asks less often (the export is a big one). */
const SLOW_AFTER_MS = 3 * 60 * 1000;
const SLOW_POLL_MS = 5000;
/** Asks in a row that may fail (offline, a 5xx) before the page stops asking. */
const MAX_MISSES = 8;
/** Say once that the page can be left, after this long. */
const STILL_RUNNING_MS = 60 * 1000;
const STORE_PREFIX = 'intelform-export:';

/** `gone`: the export is over (forget it); `quiet`: nothing to tell (an old export, swept). */
export type ExportOutcome = {ok: true; name: string} | {ok: false; message: string; gone?: boolean; quiet?: boolean};

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

interface Deps {
  fetcher?: typeof siteFetch;
  save?: typeof saveBlob;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  /** Called with every status while it runs (rows written so far). */
  onProgress?: (status: ExportStatus) => void;
  /** Called once with the export's id when it has started. */
  onStarted?: (id: string) => void;
}

/** Starts an export, waits for it and saves the file. Never throws: the outcome says what happened. */
export async function runExport(input: StartExportInput, deps: Deps = {}): Promise<ExportOutcome> {
  let status: ExportStatus;
  try {
    status = await api<ExportStatus>(EXPORTS_PATH, {method: 'POST', body: input});
  } catch (err) {
    return {ok: false, message: errorMessage(err)};
  }
  deps.onStarted?.(status.id);
  return finishExport(status, deps);
}

/** Picks up an export started earlier (a page opened again): waits for it and saves the file. */
export async function resumeExport(id: string, deps: Deps = {}): Promise<ExportOutcome> {
  let status: ExportStatus;
  try {
    status = await api<ExportStatus>(`${EXPORTS_PATH}/${encodeURIComponent(id)}`);
  } catch (err) {
    // Swept (a day later) or no longer this person's: forget it without a word.
    if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) return {ok: false, message: '', gone: true, quiet: true};
    return {ok: false, message: errorMessage(err)};
  }
  return finishExport(status, deps);
}

/** Asks until the export is no longer running, then downloads it. */
async function finishExport(first: ExportStatus, deps: Deps): Promise<ExportOutcome> {
  const fetcher = deps.fetcher ?? siteFetch;
  const sleep = deps.sleep ?? wait;
  const now = deps.now ?? Date.now;
  const started = now();
  let status = first;
  let misses = 0;
  while (status.status === 'running') {
    deps.onProgress?.(status);
    await sleep(now() - started > SLOW_AFTER_MS ? SLOW_POLL_MS : EXPORT_POLL_MS);
    try {
      status = await api<ExportStatus>(`${EXPORTS_PATH}/${encodeURIComponent(status.id)}`);
      misses = 0;
    } catch (err) {
      const passing = err instanceof ApiRequestError && (err.status === 0 || err.status >= 500);
      if (!passing || ++misses >= MAX_MISSES) {
        return {ok: false, message: passing ? 'Lost touch with the export. It keeps running: open this page again later to download it.' : errorMessage(err)};
      }
    }
  }
  if (status.status === 'failed') return {ok: false, message: status.error ?? 'The export didn’t finish. Try again.', gone: true};

  let res: Response;
  try {
    res = await fetcher(`${EXPORTS_PATH}/${encodeURIComponent(status.id)}/download`, {credentials: 'same-origin'});
  } catch {
    return {ok: false, message: OFFLINE_MESSAGE};
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    return {ok: false, message: parseErrorBody(data, 'The download didn’t start. Try again.').message, gone: res.status === 404};
  }
  try {
    (deps.save ?? saveBlob)(await res.blob(), status.fileName);
  } catch {
    return {ok: false, message: 'The download stopped part way. Try again.'};
  }
  return {ok: true, name: status.fileName};
}

/** This browser's running export for a scope (storage may be off: then nothing is remembered). */
function remembered(scope: string | undefined): string | null {
  if (!scope) return null;
  try {
    return window.localStorage.getItem(STORE_PREFIX + scope);
  } catch {
    return null;
  }
}

function remember(scope: string | undefined, id: string | null): void {
  if (!scope) return;
  try {
    if (id) window.localStorage.setItem(STORE_PREFIX + scope, id);
    else window.localStorage.removeItem(STORE_PREFIX + scope);
  } catch {
    // Not remembered: a page opened again won't pick it up.
  }
}

/** Exports this page is following now: a screen opened again joins one instead of asking twice. */
const live = new Map<string, {done: Promise<ExportOutcome>; listeners: Set<(rows: number) => void>}>();

/**
 * `run(input)` for a button: `pending` while it runs (one export at a time per screen), `rows`
 * written so far (for the button: "Exporting… 12,000 rows"), a toast when it is saved or why it
 * wasn't. `scope` (e.g. `responses:<formId>`, `contacts`, `all`) remembers a running export, so
 * opening the screen again picks it up.
 */
export function useExport(scope?: string) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [rows, setRows] = useState<number | null>(null);
  const running = useRef(false);

  const follow = useCallback(
    async (work: (deps: Deps) => Promise<ExportOutcome>) => {
      running.current = true;
      setPending(true);
      setRows(null);
      let told = false;
      let id: string | null = null;
      const listeners = new Set<(rows: number) => void>([setRows]);
      const since = Date.now();
      let settle: (out: ExportOutcome) => void = () => undefined;
      const done = new Promise<ExportOutcome>(resolve => (settle = resolve));
      try {
        const out = await work({
          onStarted: started => {
            id = started;
            remember(scope, started);
            live.set(started, {done, listeners});
          },
          onProgress: s => {
            for (const l of listeners) l(s.rows);
            if (!told && Date.now() - since > STILL_RUNNING_MS) {
              told = true;
              toast.info(
                scope
                  ? `Still exporting (${s.rows.toLocaleString()} rows so far). You can leave this page: open it again to download the file.`
                  : `Still exporting (${s.rows.toLocaleString()} rows so far).`
              );
            }
          },
        });
        settle(out);
        if (out.ok || out.gone) remember(scope, null);
        if (out.ok) toast.success(`Exported ${out.name}.`);
        else if (!out.quiet) toast.danger(out.message);
      } finally {
        if (id) live.delete(id);
        running.current = false;
        setPending(false);
        setRows(null);
      }
    },
    [scope, toast]
  );

  const run = useCallback(
    async (input: StartExportInput) => {
      if (running.current) return;
      toast.info('Preparing your export…');
      await follow(deps => runExport(input, deps));
    },
    [follow, toast]
  );

  // A screen opened again: carry on with the export this browser started here.
  useEffect(() => {
    const id = remembered(scope);
    if (!id || running.current) return;
    const joined = live.get(id);
    if (joined) {
      // Still followed by the screen that started it (it saves the file and says so): show its progress.
      running.current = true;
      setPending(true);
      joined.listeners.add(setRows);
      void joined.done.finally(() => {
        joined.listeners.delete(setRows);
        running.current = false;
        setPending(false);
        setRows(null);
      });
      return () => void joined.listeners.delete(setRows);
    }
    void follow(async deps => {
      deps.onStarted?.(id);
      return resumeExport(id, deps);
    });
  }, [scope, follow]);

  return {run, pending, rows};
}
