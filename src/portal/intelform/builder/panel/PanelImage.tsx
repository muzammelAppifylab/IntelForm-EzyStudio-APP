import {useId, useRef, useState} from 'react';

import {errorMessage} from '../../lib/api';
import {cn} from '../../lib/utils';
import {Button, Icon, Spinner, useToast} from '../../../ui';
import {checkUpload, uploadImage, UPLOAD_RULES, type UploadPurpose} from '../api';

/**
 * One image in the settings panel: preview, upload or replace, remove. Drop a file on the
 * preview or pick one. Limits from UPLOAD_RULES (the uploads route checks them again).
 * Legacy: src/builder/ImageUpload.tsx (the start-screen image).
 */
export function PanelImage({
  label,
  value,
  onChange,
  purpose,
  disabled,
}: {
  label: string;
  value: string | null | undefined;
  onChange(url: string | null): void;
  purpose: UploadPurpose;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function pick(file: File | undefined) {
    if (!file) return;
    const invalid = checkUpload(file, purpose);
    setError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      onChange(await uploadImage(file, purpose));
      toast.success('Image uploaded.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="if-panel-image" role="group" aria-labelledby={id}>
      <span id={id} className="if-panel-label">
        {label}
      </span>
      <div
        className={cn('if-panel-image-drop', purpose === 'logo' && 'is-logo')}
        aria-busy={busy || undefined}
        onDragOver={e => !disabled && e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          if (!disabled) void pick(e.dataTransfer.files[0]);
        }}>
        {value ? (
          <img src={value} alt="" />
        ) : (
          <span className="if-panel-image-empty">
            <Icon name="image-plus" size={20} />
            Drop an image or upload one
          </span>
        )}
        {busy && (
          <span className="if-panel-image-busy">
            <Spinner label="Uploading" size="sm" />
          </span>
        )}
      </div>
      <div className="if-panel-row">
        <Button variant="secondary" size="sm" icon="upload" disabled={disabled || busy} onClick={() => input.current?.click()} aria-describedby={id}>
          {value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" icon="trash" disabled={disabled || busy} onClick={() => onChange(null)} aria-describedby={id}>
            Remove
          </Button>
        )}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="if-panel-hint">{UPLOAD_RULES[purpose].help}</p>
      )}
      <input
        ref={input}
        type="file"
        accept={UPLOAD_RULES[purpose].types.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void pick(f);
        }}
      />
    </div>
  );
}
