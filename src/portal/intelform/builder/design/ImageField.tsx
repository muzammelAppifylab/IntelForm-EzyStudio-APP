import {useId, useRef, useState} from 'react';

import {Button, Icon, Spinner, useToast} from '../../../ui';
import {errorMessage} from '../../lib/api';
import {checkUpload, UPLOAD_RULES, uploadImage, type UploadPurpose} from '../api';

/**
 * One image of a form (logo, background, social preview): a preview, Upload / Replace and
 * Remove, and drag and drop. Files go through the platform's storage (builder/api.ts
 * `uploadImage`), and the absolute URL is what the theme or settings store.
 */
export function ImageField({
  label,
  description,
  value,
  onChange,
  purpose,
  disabled,
  shape = 'wide',
}: {
  label: string;
  description?: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  purpose: UploadPurpose;
  disabled?: boolean;
  /** The preview box: `logo` 3:1, `og` 1200×630, `wide` 16:9. */
  shape?: 'logo' | 'og' | 'wide';
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rule = UPLOAD_RULES[purpose];

  async function pick(file: File | undefined) {
    if (!file) return;
    const invalid = checkUpload(file, purpose);
    if (invalid) return toast.danger(invalid);
    setBusy(true);
    try {
      onChange(await uploadImage(file, purpose));
      toast.success('Image uploaded');
    } catch (err) {
      toast.danger(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="if-image-field">
      <span id={`${id}-label`} className="if-row-label">
        {label}
      </span>
      <div
        className={`if-image-box if-image-${shape}`}
        data-dragging={dragging ? '' : undefined}
        onDragOver={e => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void pick(e.dataTransfer.files[0]);
        }}>
        {value ? (
          <img src={value} alt="" className={purpose === 'logo' ? 'if-image-contain' : 'if-image-cover'} />
        ) : (
          <span className="if-image-empty">
            <Icon name="image-plus" size={20} />
            Drop an image or upload one
          </span>
        )}
        {busy && (
          <span className="if-image-busy">
            <Spinner label="Uploading" />
          </span>
        )}
      </div>
      <div className="if-row-actions">
        <Button
          variant="secondary"
          size="sm"
          icon="upload"
          disabled={disabled || busy}
          aria-describedby={`${id}-label`}
          onClick={() => input.current?.click()}>
          {value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" icon="trash" disabled={disabled || busy} aria-describedby={`${id}-label`} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
      <p className="if-row-hint">{description ? `${description} ${rule.help}` : rule.help}</p>
      <input
        ref={input}
        type="file"
        accept={rule.types.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void pick(file);
        }}
      />
    </div>
  );
}
