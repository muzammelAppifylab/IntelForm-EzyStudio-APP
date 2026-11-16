import {useId, useRef, useState} from 'react';

import {Button, Icon, Spinner, useToast} from '../../ui';
import {errorMessage} from '../lib/api';
import {cn} from '../lib/utils';
import {checkUpload, type UploadPurpose, uploadImage} from './api';
import './build/controls.css';

/** The frame's shape. Legacy passed Tailwind classes; those still work and map to the same shapes. */
export type ImageAspect = 'video' | 'wide' | 'og' | 'square' | 'aspect-video' | 'aspect-[3/1]' | 'aspect-[1200/630]' | 'aspect-square';

const ASPECT_CLASS: Record<ImageAspect, string> = {
  video: 'if-aspect-video',
  'aspect-video': 'if-aspect-video',
  wide: 'if-aspect-wide',
  'aspect-[3/1]': 'if-aspect-wide',
  og: 'if-aspect-og',
  'aspect-[1200/630]': 'if-aspect-og',
  square: 'if-aspect-square',
  'aspect-square': 'if-aspect-square',
};

/**
 * One image: preview, upload or replace, remove. 5 MB; JPG, PNG, WebP (and SVG for logos).
 * Uploads go through the platform's file storage (`uploadImage`, files.md); the value is the
 * image's absolute URL.
 */
export function ImageUpload({
  label,
  description,
  value,
  onChange,
  purpose,
  disabled,
  aspect = 'video',
}: {
  label: string;
  description?: string;
  value: string | null | undefined;
  onChange(url: string | null): void;
  purpose: UploadPurpose;
  disabled?: boolean;
  aspect?: ImageAspect;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const toast = useToast();
  const accept = purpose === 'logo' ? 'image/jpeg,image/png,image/webp,image/svg+xml' : 'image/jpeg,image/png,image/webp';

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
    <div className="if-image-upload">
      <span id={id} className="if-label">
        {label}
      </span>
      <div
        className={cn('if-image-frame', ASPECT_CLASS[aspect], over && 'is-over')}
        onDragOver={e => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
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
      <div className="if-row">
        <Button variant="secondary" size="sm" icon="upload" disabled={disabled || busy} onClick={() => input.current?.click()} aria-describedby={id}>
          {value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" icon="trash" disabled={disabled || busy} onClick={() => onChange(null)} aria-describedby={id}>
            Remove
          </Button>
        )}
      </div>
      {description && <p className="if-caption">{description}</p>}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void pick(f);
        }}
      />
    </div>
  );
}
