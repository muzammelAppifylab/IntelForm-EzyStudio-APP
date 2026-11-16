import {useState} from 'react';

import {dataSettingsInput} from '../../../lib/intelform/settings-app';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {Checkbox, Field, useToast} from '../../ui';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings} from '../queries/app-settings';
import {SettingsCard} from './bits';

/** The retention input's state → what is sent (null = keep forever). */
export function retentionValue(on: boolean, days: string): number | null | 'missing' {
  if (!on) return null;
  const t = days.trim();
  return t ? Number(t) : 'missing';
}

/** Data retention: delete responses older than N days (off by default). */
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
      description="How long responses are kept."
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
      <p className="settings-note">To keep a copy, export each form’s responses as CSV from its Responses tab.</p>
    </SettingsCard>
  );
}
