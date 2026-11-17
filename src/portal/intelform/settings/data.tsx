import {useState} from 'react';

import {dataSettingsInput} from '../../../lib/intelform/settings-app';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {Button, Checkbox, Field, Notice, useToast} from '../../ui';
import {useExport} from '../lib/exports';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings} from '../queries/app-settings';
import {SettingsCard} from './bits';

/** The retention input's state → what is sent (null = keep forever). */
export function retentionValue(on: boolean, days: string): number | null | 'missing' {
  if (!on) return null;
  const t = days.trim();
  return t ? Number(t) : 'missing';
}

/** Settings → Data → Export: one CSV per form, in a ZIP file, built by a background job. */
function ExportAll() {
  const exporter = useExport();
  return (
    <div className="form-stack settings-export" aria-labelledby="as-export-label" role="group">
      <p className="settings-note">
        <strong id="as-export-label">Export.</strong> One CSV per form, in a ZIP file. It is prepared in the background: keep this page open
        and it downloads when ready.
      </p>
      <div>
        <Button
          variant="secondary"
          icon="download"
          pending={exporter.pending}
          pendingLabel="Preparing export…"
          onClick={() => void exporter.run({kind: 'all'})}>
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
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const value = retentionValue(on, days);
  const dirty = value !== initialDays;

  function submit() {
    if (value === 'missing') return errors.setFieldErrors({retentionDays: 'Enter a number of days'});
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
        description="Off by default: responses are kept until you delete them. When on, a daily job removes responses older than the limit from every form (one setting for all forms). Deleted responses can’t be brought back."
        checked={on}
        onChange={setOn}
      />
      {on && (
        <Field id="as-retention" label="Delete responses older than" hint="In days, from 1 to 3650." error={errors.fields.retentionDays}>
          <div className="settings-days">
            <input
              {...errors.control('retentionDays', 'as-retention', {hint: true})}
              inputMode="numeric"
              value={days}
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
