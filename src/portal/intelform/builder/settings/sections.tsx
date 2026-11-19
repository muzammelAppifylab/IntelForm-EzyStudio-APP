import {useQuery} from '@tanstack/react-query';
import {useMemo, useState} from 'react';

import type {FormStatusResponse} from '../../../../lib/intelform/api-forms';
import {formSettingsPatch, STEP_SOUNDS, type StepSound} from '../../../../lib/intelform/form/settings';
import {playStepSound} from '../../../../respondent/sound';
import {Button, Checkbox, Field, Notice, PasswordInput, RadioCards, Switch, useConfirm, useToast} from '../../../ui';
import {api, errorMessage} from '../../lib/api';
import {fieldName} from '../ops';
import {PipeInput} from '../pipe/PipeInput';
import {useBuilder, useBuilderStore} from '../store';
import {browserTimeZone, isoToZoned, resolveZonedTime, shiftedTimeNote, timeZones, zonedToIso} from '../tz';
import {useDraftText} from '../use-draft-text';
import {applyStatus, useSettingsSave} from './hooks';
import {defaultCloseLocal, isRedirectUrl, toggleRecipient} from './logic';
import {capabilitiesQuery, teammatesQuery} from './queries';
import {Hint, SelectRow, SettingsCard, TextRow} from './shared';

/** The form's Email questions, for "one response per email" and the confirmation email. */
function useEmailFields() {
  const draft = useBuilder(s => s.doc.draft);
  return useMemo(
    () => draft.fields.filter(f => f.type === 'email').map(f => ({value: f.id, label: fieldName(draft, f)})),
    [draft]
  );
}

// ------------------------------------------------------------ access and limits --

export function AccessSection() {
  const store = useBuilderStore();
  const toast = useToast();
  const settings = useBuilder(s => s.settings);
  const status = useBuilder(s => s.meta.status);
  const readOnly = useBuilder(s => s.readOnly);
  const {save, errors} = useSettingsSave();
  const emailFields = useEmailFields();
  const [closing, setClosing] = useState(false);
  // Said under the close date when the picked time fell in a clock change and was moved forward.
  const [closeNote, setCloseNote] = useState<string | null>(null);
  const closedMessage = useDraftText(settings.closedMessage, v => void save({closedMessage: v}));
  const zones = useMemo(() => timeZones().map(z => ({value: z, label: z.replace(/_/g, ' ')})), []);
  // A form that never had a close date shows the creator's own zone, not UTC.
  const tz = settings.timezone === 'UTC' && !settings.closeAt ? browserTimeZone() : settings.timezone;
  const [capOn, setCapOn] = useState(settings.responseCap !== null);
  const [capText, setCapText] = useState(settings.responseCap === null ? '' : String(settings.responseCap));

  async function toggleClosed(close: boolean) {
    setClosing(true);
    try {
      await store.getState().flush();
      const id = encodeURIComponent(store.getState().meta.id);
      applyStatus(store, await api<FormStatusResponse>(`/site-api/forms/${id}/${close ? 'close' : 'reopen'}`, {method: 'POST'}));
      toast.success(close ? 'Form closed' : 'Form reopened');
    } catch (err) {
      toast.danger(errorMessage(err));
    } finally {
      setClosing(false);
    }
  }

  return (
    <SettingsCard id="access" title="Access and limits" description="Who can respond, and when the form stops taking responses.">
      <Switch
        label="Close the form now"
        description={
          status === 'draft' ? 'Publish the form first; a draft is not open to anyone yet.' : 'Visitors see the closed message instead of the form.'
        }
        checked={status === 'closed'}
        disabled={readOnly || status === 'draft'}
        pending={closing}
        onChange={v => void toggleClosed(v)}
      />

      <div className="if-group">
        <Switch
          label="Close on a date"
          checked={settings.closeAt !== null}
          disabled={readOnly}
          onChange={v => {
            setCloseNote(null);
            void save(v ? {closeAt: zonedToIso(defaultCloseLocal(), tz), timezone: tz} : {closeAt: null});
          }}
        />
        {settings.closeAt && (
          <div className="if-two-cols">
            <TextRow
              label="Date and time"
              type="datetime-local"
              value={isoToZoned(settings.closeAt, tz)}
              disabled={readOnly}
              error={errors.closeAt}
              hint={closeNote ?? undefined}
              onChange={v => {
                const resolved = resolveZonedTime(v, tz);
                setCloseNote(shiftedTimeNote(v, resolved, tz));
                if (resolved) void save({closeAt: resolved.iso, timezone: tz});
              }}
            />
            <SelectRow
              label="Time zone"
              value={tz}
              options={zones}
              disabled={readOnly}
              onChange={z => {
                const local = isoToZoned(settings.closeAt!, tz);
                const resolved = resolveZonedTime(local, z);
                setCloseNote(shiftedTimeNote(local, resolved, z));
                void save({timezone: z, closeAt: resolved?.iso ?? null});
              }}
            />
          </div>
        )}
      </div>

      <div className="if-group">
        <Switch
          label="Limit the number of responses"
          description="Closes the form after this many completed responses."
          checked={capOn}
          disabled={readOnly}
          onChange={v => {
            setCapOn(v);
            setCapText(v ? '100' : '');
            void save({responseCap: v ? 100 : null});
          }}
        />
        {capOn && (
          <TextRow
            label="Maximum responses"
            type="number"
            inputMode="numeric"
            min={1}
            max={10_000_000}
            placeholder="100"
            value={capText}
            disabled={readOnly}
            error={errors.responseCap}
            onChange={v => {
              setCapText(v);
              const n = Number(v);
              if (v.trim() && Number.isInteger(n) && n >= 1 && n <= 10_000_000) void save({responseCap: n});
            }}
          />
        )}
      </div>

      <TextRow label="Closed message" multiline maxLength={1000} disabled={readOnly} error={errors.closedMessage} {...closedMessage} />

      <Switch
        label="One response per browser"
        description="A soft limit: stops repeat answers from the same browser, not a determined person."
        checked={settings.onePerBrowser}
        disabled={readOnly}
        onChange={v => void save({onePerBrowser: v})}
      />

      <div className="if-group">
        <Switch
          label="One response per email address"
          description={emailFields.length ? 'Refuses a second response with the same email.' : 'Add an Email question to use this.'}
          checked={settings.onePerEmail}
          disabled={readOnly || (!emailFields.length && !settings.onePerEmail)}
          onChange={v =>
            void save({
              onePerEmail: v,
              onePerEmailFieldId: v ? (settings.onePerEmailFieldId ?? emailFields[0]?.value ?? null) : settings.onePerEmailFieldId,
            })
          }
        />
        {settings.onePerEmail && emailFields.length > 0 && (
          <SelectRow
            label="Email question to check"
            value={settings.onePerEmailFieldId}
            options={emailFields}
            disabled={readOnly}
            onChange={v => void save({onePerEmailFieldId: v})}
          />
        )}
      </div>

      <PasswordSetting />
    </SettingsCard>
  );
}

function PasswordSetting() {
  const hasPassword = useBuilder(s => s.settings.hasPassword);
  const readOnly = useBuilder(s => s.readOnly);
  const {save, errors} = useSettingsSave();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const confirm = useConfirm();

  async function remove() {
    setRemoving(true);
    try {
      await confirm({
        title: 'Remove the password?',
        body: 'Anyone with the link will be able to respond.',
        confirmLabel: 'Remove password',
        pendingLabel: 'Removing…',
        action: async () => {
          if (!(await save({password: null}, 'Password removed'))) throw new Error('The password wasn’t removed. Try again.');
        },
      });
    } finally {
      setRemoving(false);
    }
  }

  async function submit() {
    const parsed = formSettingsPatch.shape.password.safeParse(value);
    if (!parsed.success || !value) return setError(parsed.error?.issues[0]?.message ?? 'Use at least 8 characters');
    setBusy(true);
    const ok = await save({password: value}, 'Password set');
    setBusy(false);
    if (ok) {
      setEditing(false);
      setValue('');
    }
  }

  return (
    <div className="if-group">
      <div className="if-row-between">
        <div className="if-row-text">
          <span className="if-row-label">Password protection</span>
          <span className="if-row-hint">
            {hasPassword
              ? 'Respondents enter the password before the form opens. It is stored hashed and can’t be shown.'
              : 'Off. Anyone with the link can respond.'}
          </span>
        </div>
        {!readOnly && !editing && (
          <div className="if-row-actions">
            <Button size="sm" variant="secondary" icon="key" disabled={removing} onClick={() => setEditing(true)}>
              {hasPassword ? 'Change' : 'Set password'}
            </Button>
            {hasPassword && (
              <Button size="sm" variant="danger" pending={removing} pendingLabel="Removing…" onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <form
          className="if-inline-form"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}>
          <PasswordField value={value} error={error ?? errors.password ?? null} onChange={v => (setValue(v), setError(null))} />
          <div className="if-row-actions">
            <Button type="submit" pending={busy} pendingLabel="Saving…">
              Save password
            </Button>
            <Button variant="ghost" onClick={() => (setEditing(false), setValue(''), setError(null))}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function PasswordField({value, error, onChange}: {value: string; error: string | null; onChange: (v: string) => void}) {
  const id = 'if-form-password';
  return (
    <Field id={id} label="New password" hint="At least 8 characters." error={error ?? undefined}>
      <PasswordInput
        id={id}
        autoComplete="new-password"
        autoFocus
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onChange={e => onChange(e.target.value)}
      />
    </Field>
  );
}

// ------------------------------------------------------------------ after submit --

export function AfterSubmitSection() {
  const settings = useBuilder(s => s.settings);
  const readOnly = useBuilder(s => s.readOnly);
  const {save, errors} = useSettingsSave();
  const [url, setUrl] = useState(settings.redirectUrl ?? '');
  const [touched, setTouched] = useState(false);
  // The server only accepts "redirect" with a link, so picking it before there is one is held
  // here and saved as soon as a valid link is typed. Until then respondents see the end screen.
  const [picked, setPicked] = useState<'end_screen' | 'redirect' | null>(null);
  const choice = picked ?? settings.afterSubmit;
  const valid = isRedirectUrl(url);
  const pending = choice === 'redirect' && settings.afterSubmit !== 'redirect';

  return (
    <SettingsCard id="after-submit" title="After submit">
      <RadioCards
        legend="After submit"
        name="after-submit"
        value={choice}
        columns={2}
        options={[
          {value: 'end_screen', title: 'Show the end screen', description: 'The thank-you screen from the Build tab.', disabled: readOnly},
          {value: 'redirect', title: 'Send people to a web page', description: 'Skip the end screen and open a link instead.', disabled: readOnly},
        ]}
        onChange={v => {
          setPicked(v);
          if (v === 'end_screen') void save({afterSubmit: 'end_screen'});
          else if (valid) void save({afterSubmit: 'redirect', redirectUrl: url.trim()});
        }}
      />
      {choice === 'redirect' && (
        <>
          <TextRow
            label="Redirect link"
            type="url"
            inputMode="url"
            placeholder="https://example.com/thanks"
            value={url}
            disabled={readOnly}
            autoFocus={picked === 'redirect' && !valid}
            hint={pending ? 'Until you add a link, people still see the end screen.' : undefined}
            error={errors.redirectUrl ?? (touched && url.trim() && !valid ? 'Enter a full link starting with https://' : null)}
            onBlur={() => setTouched(true)}
            onChange={v => {
              setUrl(v);
              if (isRedirectUrl(v)) void save({afterSubmit: 'redirect', redirectUrl: v.trim()});
            }}
          />
          <Switch
            label="Add the answers to the link"
            description="Appends answers as URL parameters, e.g. ?email=…, for a thank-you page that greets people."
            checked={settings.redirectAppendAnswers}
            disabled={readOnly || pending}
            onChange={v => void save({redirectAppendAnswers: v})}
          />
        </>
      )}
    </SettingsCard>
  );
}

// ------------------------------------------------------------------------ sounds --

const SOUND_LABEL: Record<StepSound, string> = {off: 'Off', tick: 'Tick', chime: 'Chime', pop: 'Pop'};
const SOUND_OPTIONS = STEP_SOUNDS.map(value => ({value, label: SOUND_LABEL[value]}));

export function SoundsSection() {
  const stepSound = useBuilder(s => s.settings.stepSound);
  const layout = useBuilder(s => s.doc.draft.layout);
  const readOnly = useBuilder(s => s.readOnly);
  const {save} = useSettingsSave();
  return (
    <SettingsCard id="sounds" title="Sounds" description="A short sound when a respondent answers a question and moves on.">
      <SelectRow
        label="Step sound"
        value={stepSound}
        options={SOUND_OPTIONS}
        disabled={readOnly}
        hint="Plays when moving to the next question or section, with a higher note on submit. Works with the One at a time and Section by section layouts; on submit it plays in every layout."
        onChange={v => {
          void save({stepSound: v});
          playStepSound(v);
        }}
      />
      {stepSound !== 'off' && layout === 'all_at_once' && (
        <Notice tone="info">This form uses the All at once layout, so the sound plays only when the form is submitted.</Notice>
      )}
    </SettingsCard>
  );
}

// ----------------------------------------------------------------- notifications --

export function NotificationsSection() {
  const settings = useBuilder(s => s.settings);
  const readOnly = useBuilder(s => s.readOnly);
  const fieldCount = useBuilder(s => s.doc.draft.fields.length);
  const {save, errors} = useSettingsSave();
  const caps = useQuery(capabilitiesQuery);
  const team = useQuery({...teammatesQuery, enabled: settings.notifyOnResponse});
  const emailFields = useEmailFields();
  const subject = useDraftText(settings.confirmationSubject, v => void save({confirmationSubject: v}));
  const body = useDraftText(settings.confirmationBody, v => void save({confirmationBody: v}), 900);
  const emailOff = caps.data ? !caps.data.emailEnabled : false;
  const members = team.data?.members ?? [];
  const owner = members.find(m => m.owner);
  const selected = new Set(settings.notifyRecipients);

  return (
    <SettingsCard id="notifications" title="Notifications" description="Emails sent when someone responds.">
      {emailOff && (
        <Notice tone="warning">
          Email isn’t set up on this site yet, so these emails won’t be sent. Your choices here are kept and used once it is.
        </Notice>
      )}
      <div className="if-group">
        <Switch
          label="Email me on each response"
          description="Includes every answer and a link to the response."
          checked={settings.notifyOnResponse}
          disabled={readOnly}
          onChange={v => void save({notifyOnResponse: v})}
        />
        {settings.notifyOnResponse && (
          <fieldset className="if-fieldset">
            <legend>Who gets it</legend>
            <Hint>With nobody ticked, it goes to the site owner{owner ? ` (${owner.name})` : ''}.</Hint>
            {team.isPending && <Hint>Loading the team…</Hint>}
            {team.isError && <Notice tone="warning">The team list couldn’t load: {errorMessage(team.error)}</Notice>}
            {members.map(m => (
              <Checkbox
                key={m.id}
                label={m.name}
                description={m.email}
                checked={selected.has(m.id)}
                disabled={readOnly}
                onChange={c => void save({notifyRecipients: toggleRecipient(settings.notifyRecipients, m.id, c)})}
              />
            ))}
          </fieldset>
        )}
      </div>
      <div className="if-group">
        <Switch
          label="Send a confirmation to the respondent"
          description={emailFields.length ? 'Goes to the address they enter in an Email question.' : 'Add an Email question to use this.'}
          checked={settings.confirmationEmail}
          disabled={readOnly || (!emailFields.length && !settings.confirmationEmail)}
          onChange={v =>
            void save({
              confirmationEmail: v,
              ...(v && !settings.confirmationEmailFieldId ? {confirmationEmailFieldId: emailFields[0]?.value ?? null} : {}),
            })
          }
        />
        {settings.confirmationEmail && (
          <>
            <SelectRow
              label="Send to the address in"
              value={settings.confirmationEmailFieldId}
              options={emailFields}
              disabled={readOnly}
              error={errors.confirmationEmailFieldId}
              onChange={v => void save({confirmationEmailFieldId: v})}
            />
            <TextRow label="Subject" maxLength={200} disabled={readOnly} error={errors.confirmationSubject} {...subject} />
            <div className="if-pipe-field">
              <span className="if-row-label" id="if-confirmation-body">
                Message
              </span>
              <PipeInput
                ariaLabel="Confirmation message"
                multiline
                value={body.value}
                onChange={body.onChange}
                beforeIndex={fieldCount}
                readOnly={readOnly}
                describedBy="if-confirmation-body-hint"
                invalid={!!errors.confirmationBody}
              />
              <Hint>
                <span id="if-confirmation-body-hint">Type @ to include an answer, e.g. their name.</span>
              </Hint>
              {errors.confirmationBody && <p className="field-error">{errors.confirmationBody}</p>}
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
