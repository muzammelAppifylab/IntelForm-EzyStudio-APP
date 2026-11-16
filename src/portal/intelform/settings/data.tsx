import {useState} from 'react';

import {siteFetch} from '../../../platform/browser';
import {dataSettingsInput} from '../../../lib/intelform/settings-app';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {Button, Checkbox, Field, Notice, useToast} from '../../ui';
import {OFFLINE_MESSAGE, parseErrorBody} from '../lib/api';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings} from '../queries/app-settings';
import {SettingsCard} from './bits';

/** The retention input's state → what is sent (null = keep forever). */
export function retentionValue(on: boolean, days: string): number | null | 'missing' {
  if (!on) return null;
  const t = days.trim();
  return t ? Number(t) : 'missing';
}

/** Every form's responses, one CSV per form in a ZIP (APP_SETTINGS; 5 per 10 minutes per person). */
export const EXPORT_ALL_PATH = '/site-api/responses/export-all.zip';

export const EXPORT_FAILED = 'The export didn’t start. Try again.';

/** The file name from a `Content-Disposition` header (`filename*` first), else a dated default. */
export function zipFileName(header: string | null, today = new Date().toISOString().slice(0, 10)): string {
  const fallback = `responses ${today}.zip`;
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      const name = decodeURIComponent(star[1].trim());
      if (name) return name;
    } catch {
      // a malformed escape: fall back to the plain name
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  const name = plain?.[1]?.trim();
  return name || fallback;
}

export type ExportResult = {ok: true; blob: Blob; name: string} | {ok: false; status: number; message: string};

/**
 * Fetches the all-responses ZIP through the session (`siteFetch`, so it also works in the
 * editor Preview, whose gateway drops the cookies a plain link would rely on). A refused
 * export (429 "Try again in a few minutes", 403, 5xx) comes back as the server's message
 * instead of a broken download. Status 0 = offline.
 */
export async function fetchAllResponsesZip(fetcher: (input: string, init?: RequestInit) => Promise<Response> = siteFetch): Promise<ExportResult> {
  let res: Response;
  try {
    res = await fetcher(EXPORT_ALL_PATH, {credentials: 'same-origin'});
  } catch {
    return {ok: false, status: 0, message: OFFLINE_MESSAGE};
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    return {ok: false, status: res.status, message: parseErrorBody(data, EXPORT_FAILED).message};
  }
  try {
    return {ok: true, blob: await res.blob(), name: zipFileName(res.headers.get('Content-Disposition'))};
  } catch {
    // The stream broke part way (the connection dropped, the server gave up).
    return {ok: false, status: res.status, message: EXPORT_FAILED};
  }
}

/** Saves a Blob as a file through a temporary object URL. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Settings → Data → Export: one CSV per form, in a ZIP file. */
function ExportAll() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await fetchAllResponsesZip();
    setBusy(false);
    if (!result.ok) return setError(result.message);
    saveBlob(result.blob, result.name);
    toast.success('Responses exported.');
  }

  return (
    <div className="form-stack settings-export" aria-labelledby="as-export-label" role="group">
      <p className="settings-note">
        <strong id="as-export-label">Export.</strong> One CSV per form, in a ZIP file. Large exports can take a minute to start.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div>
        <Button variant="secondary" icon="download" pending={busy} pendingLabel="Preparing export…" onClick={() => void run()}>
          Export all responses (ZIP)
        </Button>
      </div>
    </div>
  );
}

/** Data retention: delete responses older than N days (off by default), and the all-responses export. */
export function DataGroup({view}: {view: AppSettingsResponse}) {
  const initialDays = view.data.retentionDays;
  const [on, setOn] = useState(initialDays !== null);
  const [days, setDays] = useState(initialDays === null ? '365' : String(initialDays));
  const [missing, setMissing] = useState(false);
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const value = retentionValue(on, days);
  const dirty = value !== initialDays;

  function submit() {
    setMissing(value === 'missing');
    if (value === 'missing') return errors.clear();
    const data = errors.validate(dataSettingsInput, {retentionDays: value});
    if (!data) return;
    save.mutate(
      {data},
      {
        onSuccess: next => {
          setOn(next.data.retentionDays !== null);
          if (next.data.retentionDays !== null) setDays(String(next.data.retentionDays));
          toast.success(next.data.retentionDays === null ? 'Responses are kept.' : 'Retention saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  return (
    <SettingsCard
      title="Data"
      description="How long responses are kept, and a copy of all of them."
      onSubmit={submit}
      dirty={dirty}
      saving={save.isPending}
      formError={errors.form}>
      <Checkbox
        label="Delete old responses"
        description="Off by default: responses are kept until you delete them. When on, a daily job removes responses older than the limit. Deleted responses can’t be brought back."
        checked={on}
        onChange={setOn}
      />
      {on && (
        <Field id="as-retention" label="Delete responses older than" hint="In days, from 1 to 3650." error={missing ? 'Enter a number of days' : errors.fields.retentionDays}>
          <div className="settings-days">
            <input
              id="as-retention"
              inputMode="numeric"
              value={days}
              aria-invalid={missing || errors.fields.retentionDays ? true : undefined}
              onChange={e => setDays(e.target.value.replace(/\D/g, ''))}
            />
            <span>days</span>
          </div>
        </Field>
      )}
      <ExportAll />
      <p className="settings-note">To export a single form, use CSV on its Responses tab.</p>
    </SettingsCard>
  );
}
