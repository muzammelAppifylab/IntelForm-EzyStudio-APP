import {type FormEvent, type ReactNode, useId, useRef, useState, type ChangeEvent} from 'react';

import {UPLOAD_TYPES, type UploadPurpose} from '../../../lib/intelform/settings-app';
import {Button, Card, Icon, Notice} from '../../ui';
import {errorMessage} from '../lib/api';
import {UPLOAD_HELP, uploadSettingsImage} from './upload';

/** JSON equality for small plain objects (dirty checks). */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * One settings group: a Card holding its own form, Save button and "Unsaved changes" hint
 * (ui.md "Settings screen": one Card per topic, Save in the card).
 */
export function SettingsCard({
  title,
  description,
  children,
  onSubmit,
  dirty,
  saving,
  formError,
  extraActions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onSubmit?: () => void;
  dirty?: boolean;
  saving?: boolean;
  formError?: string | null;
  extraActions?: ReactNode;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit?.();
  }
  return (
    <Card title={title} description={description}>
      <form className="form-stack" noValidate onSubmit={submit}>
        {formError && <Notice tone="danger">{formError}</Notice>}
        {children}
        {(onSubmit || extraActions) && (
          <div className="form-actions settings-actions">
            {onSubmit && (
              <Button type="submit" pending={saving} pendingLabel="Saving…" disabled={dirty === false}>
                Save
              </Button>
            )}
            {extraActions}
            {dirty && <span className="settings-unsaved">Unsaved changes</span>}
          </div>
        )}
      </form>
    </Card>
  );
}

/**
 * An image setting: preview, Upload / Replace and Remove. The value is the stored path
 * (`/__platform/files/<id>/<name>`). `shape` only changes the preview frame.
 */
export function ImageUpload({
  label,
  description,
  purpose,
  value,
  onChange,
  disabled,
  shape = 'wide',
  error,
  controlId,
}: {
  label: string;
  description?: string;
  purpose: UploadPurpose;
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
  shape?: 'wide' | 'square';
  error?: string;
  /**
   * The Upload button's id (from `errors.control(name, id)`): the hint / error below are
   * tied to it by `aria-describedby`, and a failed save can focus it (F-042).
   */
  controlId?: string;
}) {
  const auto = useId();
  const id = controlId ?? auto;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = localError ?? error;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLocalError(null);
    setBusy(true);
    try {
      onChange(await uploadSettingsImage(file, purpose));
    } catch (err) {
      setLocalError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-image" role="group" aria-labelledby={`${id}-label`} data-invalid={shown ? '' : undefined}>
      <span id={`${id}-label`} className="settings-image-label">
        {label}
      </span>
      <div className="settings-image-row">
        <div className={`settings-image-frame settings-image-${shape}`}>
          {value ? <img src={value} alt="" /> : <Icon name="image-plus" size={20} />}
        </div>
        <div className="settings-image-buttons">
          <Button
            id={controlId}
            size="sm"
            variant="secondary"
            icon="upload"
            pending={busy}
            pendingLabel="Uploading…"
            disabled={disabled}
            aria-describedby={shown ? `${id}-error` : `${id}-hint`}
            onClick={() => input.current?.click()}>
            {value ? 'Replace' : 'Upload'}
            <span className="visually-hidden"> {label.toLowerCase()}</span>
          </Button>
          {value && (
            <Button size="sm" variant="ghost" icon="trash" disabled={disabled || busy} onClick={() => onChange(null)}>
              Remove<span className="visually-hidden"> {label.toLowerCase()}</span>
            </Button>
          )}
        </div>
        <input ref={input} type="file" hidden accept={UPLOAD_TYPES[purpose].join(',')} onChange={pick} />
      </div>
      {!shown && (
        <p className="field-hint" id={`${id}-hint`}>
          {description ?? UPLOAD_HELP[purpose]}
        </p>
      )}
      {shown && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {shown}
        </p>
      )}
    </div>
  );
}
