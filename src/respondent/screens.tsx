import {type FormEvent, type ReactNode, useEffect, useId, useRef, useState} from 'react';

import type {EndScreen, StartScreen as StartScreenDef} from '../lib/intelform/form/definition';
import {formatLabel, type Labels} from '../lib/intelform/form/labels';
import {RIcon} from './icons';
import {FieldError, FormButton, FormLink, TextInput} from './ui';
import {cx} from './util';

/** Start, end, closed, not-found and password screens. Each moves focus to its heading. */

function useFocusOnMount(on: boolean) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (on) ref.current?.focus({preventScroll: true});
  }, [on]);
  return ref;
}

function Screen({center, children, className}: {center: boolean; children: ReactNode; className?: string}) {
  return (
    <div className="rf-screen">
      <div className={cx('rf-screen-body', center && 'rf-center', className)}>{children}</div>
    </div>
  );
}

export function StartScreen({
  screen,
  labels,
  center,
  focus,
  onStart,
}: {
  screen: StartScreenDef;
  labels: Labels;
  center: boolean;
  focus: boolean;
  onStart: () => void;
}) {
  const ref = useFocusOnMount(focus);
  const minutes = screen.minutes ? (screen.minutes === 1 ? labels.minutesOne : formatLabel(labels.minutes, {n: screen.minutes})) : null;
  return (
    <Screen center={center}>
      {screen.imageUrl && <img src={screen.imageUrl} alt={screen.imageAlt ?? ''} fetchPriority="high" className="rf-start-image" />}
      <h1 ref={ref} tabIndex={-1} className="rf-question-xl rf-heading">
        {screen.title || ' '}
      </h1>
      {screen.description && <p className="rf-text-answer rf-muted rf-pre-line rf-prose">{screen.description}</p>}
      <div className="rf-row">
        <FormButton onClick={onStart}>
          {screen.button || labels.start}
          <RIcon name="arrow-right" />
        </FormButton>
        {minutes && (
          <span className="rf-inline-meta rf-text-body rf-muted">
            <RIcon name="clock" className="rf-icon-sm" />
            {minutes}
          </span>
        )}
      </div>
    </Screen>
  );
}

export function EndScreenView({
  screen,
  labels,
  pipe,
  center,
  embedded,
}: {
  screen: EndScreen;
  labels: Labels;
  pipe: (t: string | undefined) => string;
  center: boolean;
  embedded?: boolean;
}) {
  const ref = useFocusOnMount(true);
  const title = pipe(screen.title).trim() || labels.thanks;
  const message = pipe(screen.message).trim();
  return (
    <Screen center={center}>
      <h1 ref={ref} tabIndex={-1} className="rf-question-xl rf-heading">
        {title}
      </h1>
      {message && <p className="rf-text-answer rf-muted rf-pre-line rf-prose">{message}</p>}
      {screen.button && (
        <div className="rf-row">
          <FormLink href={screen.button.url} target={embedded ? '_blank' : '_top'} rel="noopener noreferrer">
            {screen.button.label}
            <RIcon name="arrow-right" />
          </FormLink>
        </div>
      )}
    </Screen>
  );
}

/** Closed form, unknown link, already responded. */
export function MessageScreen({title, message, center, focus = true}: {title: string; message?: string; center: boolean; focus?: boolean}) {
  const ref = useFocusOnMount(focus);
  return (
    <Screen center={center}>
      <h1 ref={ref} tabIndex={-1} className="rf-question-xl rf-heading">
        {title}
      </h1>
      {message && <p className="rf-text-answer rf-muted rf-pre-line rf-prose">{message}</p>}
    </Screen>
  );
}

export function PasswordGate({
  title,
  labels,
  center,
  onUnlock,
}: {
  title: string;
  labels: Labels;
  center: boolean;
  /** Resolves to an error message, or null when unlocked. */
  onUnlock: (password: string) => Promise<string | null>;
}) {
  const ref = useFocusOnMount(true);
  const id = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) return setError(labels.wrongPassword);
    setBusy(true);
    const err = await onUnlock(password).catch(() => labels.submitError);
    setBusy(false);
    setError(err);
  };
  return (
    <Screen center={center}>
      <RIcon name="lock" className="rf-icon-lg rf-answer-colour" />
      <h1 ref={ref} tabIndex={-1} className="rf-question-xl rf-heading">
        {title}
      </h1>
      <form onSubmit={submit} noValidate className="rf-password-form">
        <label htmlFor={id} className="rf-text-answer rf-muted">
          {labels.passwordPrompt}
        </label>
        <span className="rf-password">
          <TextInput
            id={id}
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            value={password}
            onValueChange={v => {
              setPassword(v);
              if (error) setError(null);
            }}
            className="rf-password-input"
          />
          <button type="button" className="rf-password-reveal" aria-pressed={shown} aria-controls={id} onClick={() => setShown(s => !s)}>
            {shown ? 'Hide' : 'Show'}
          </button>
        </span>
        {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
        <FormButton type="submit" disabled={busy} aria-busy={busy || undefined} className="rf-fit">
          {busy ? `${labels.unlock}…` : labels.unlock}
          <RIcon name="arrow-right" />
        </FormButton>
      </form>
    </Screen>
  );
}
