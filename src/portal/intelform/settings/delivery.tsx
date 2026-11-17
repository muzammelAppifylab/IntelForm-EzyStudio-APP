import {useState} from 'react';

import {notificationSettingsInput} from '../../../lib/intelform/settings-app';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {Badge, Button, DefinitionList, Field, Notice, useToast} from '../../ui';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings, useTurnstileTest} from '../queries/app-settings';
import {SettingsCard, TestResult} from './bits';

function SecretBadge({set}: {set: boolean}) {
  return set ? (
    <Badge tone="success" icon="check">
      Added
    </Badge>
  ) : (
    <Badge tone="neutral">Not added</Badge>
  );
}

/**
 * Spam protection: Cloudflare Turnstile. Both keys are OWNER SECRETS now (added by the site's
 * owner in the platform, never saved or shown here): this card says whether each is present and
 * can check the secret key with Cloudflare.
 */
export function SpamGroup({view}: {view: AppSettingsResponse}) {
  const test = useTurnstileTest();
  const {turnstileSiteKeySet: siteKeySet, turnstileSecretSet: secretSet} = view.spam;
  const configured = siteKeySet && secretSet;
  return (
    <SettingsCard
      title="Spam protection"
      description="Optional. Cloudflare Turnstile checks that a person, not a bot, submits your forms. Each form can turn it off in its settings."
      extraActions={
        <Button variant="secondary" icon="shield" disabled={!secretSet} pending={test.isPending} pendingLabel="Testing…" onClick={() => test.mutate()}>
          Test keys
        </Button>
      }>
      <p className="settings-note">
        Without keys, forms are still protected by a honeypot and a rate limit. To add Turnstile, create a widget in the Cloudflare dashboard under
        Turnstile and add this site’s domain. Then ask the site’s owner to add both keys as <strong>owner secrets</strong> named{' '}
        <code>TURNSTILE_SITE_KEY</code> and <code>TURNSTILE_SECRET_KEY</code>. They are kept by the platform, never stored or shown here.
      </p>
      <DefinitionList
        items={[
          {label: 'Site key (TURNSTILE_SITE_KEY)', value: <SecretBadge set={siteKeySet} />},
          {label: 'Secret key (TURNSTILE_SECRET_KEY)', value: <SecretBadge set={secretSet} />},
          {
            label: 'Forms',
            value: configured ? 'Checked by Turnstile' : siteKeySet || secretSet ? 'Not checked yet: add the other key' : 'Honeypot and rate limit only',
          },
        ]}
      />
      <TestResult result={test.data ?? (test.error ? {ok: false, message: test.error.message} : null)} />
    </SettingsCard>
  );
}

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
