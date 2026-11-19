import {useState} from 'react';

import {notificationSettingsInput} from '../../../lib/intelform/settings-app';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {Field, Notice, useToast} from '../../ui';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings} from '../queries/app-settings';
import {SettingsCard} from './bits';

/** Notification defaults: the sender name and reply-to address of the emails IntelForm sends. */
export function NotificationsGroup({view}: {view: AppSettingsResponse}) {
  const initial = {fromName: view.notifications.fromName ?? '', replyTo: view.notifications.replyTo ?? ''};
  const [v, setV] = useState(initial);
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const dirty = v.fromName.trim() !== initial.fromName || v.replyTo.trim() !== initial.replyTo;

  function submit() {
    const data = errors.validate(notificationSettingsInput, {
      fromName: v.fromName.trim() || null,
      replyTo: v.replyTo.trim() || null,
    });
    if (!data) return;
    save.mutate(
      {notifications: data},
      {
        onSuccess: next => {
          setV({fromName: next.notifications.fromName ?? '', replyTo: next.notifications.replyTo ?? ''});
          toast.success('Notification defaults saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  return (
    <SettingsCard
      title="Notifications"
      description="Response notifications and confirmation emails go out through the platform’s email service: there is no mail server to set up."
      onSubmit={submit}
      dirty={dirty}
      saving={save.isPending}
      formError={errors.form}>
      {view.notifications.enabled ? (
        <Notice tone="success">Emails are on. They are sent from the platform’s address, with the name and reply-to below.</Notice>
      ) : (
        <Notice tone="warning" title="Emails are off here">
          This copy of the site has no Site Key, so no emails go out. They are sent once the site runs on the platform.
        </Notice>
      )}
      <Field id="as-from-name" label="Sender name" optional hint={`Leave empty to use the app name (${view.general.appName}).`} error={errors.fields.fromName}>
        <input
          {...errors.control('fromName', 'as-from-name', {hint: true})}
          value={v.fromName}
          maxLength={100}
          placeholder={view.general.appName}
          onChange={e => setV(p => ({...p, fromName: e.target.value}))}
        />
      </Field>
      <Field id="as-reply-to" label="Reply-to address" optional hint="Where replies to these emails go. Leave empty for no reply-to." error={errors.fields.replyTo}>
        <input
          {...errors.control('replyTo', 'as-reply-to', {hint: true})}
          type="email"
          value={v.replyTo}
          placeholder="team@example.com"
          onChange={e => setV(p => ({...p, replyTo: e.target.value}))}
        />
      </Field>
    </SettingsCard>
  );
}
