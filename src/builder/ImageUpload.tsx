import { useId, useRef, useState } from 'react'
import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/components/ui/cn'
import { errorMessage } from '@/lib/api'
import { uploadImage } from './api'

const MAX = 5 * 1024 * 1024

/** One image: preview, upload or replace, remove. 5 MB; JPG, PNG, WebP (and SVG for logos). */
export function ImageUpload({
  label,
  description,
  value,
  onChange,
  purpose,
  disabled,
  aspect = 'aspect-video',
}: {
  label: string
  description?: string
  value: string | null | undefined
  onChange(url: string | null): void
  purpose: 'logo' | 'image' | 'og'
  disabled?: boolean
  aspect?: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const accept = purpose === 'logo' ? 'image/jpeg,image/png,image/webp,image/svg+xml' : 'image/jpeg,image/png,image/webp'

  async function pick(file: File | undefined) {
    if (!file) return
    if (file.size > MAX) return toast.error('That image is larger than 5 MB. Choose a smaller one.')
    if (!accept.split(',').includes(file.type)) return toast.error(purpose === 'logo' ? 'Use a JPG, PNG, WebP or SVG image' : 'Use a JPG, PNG or WebP image')
    setBusy(true)
    try {
      onChange(await uploadImage(file, purpose))
      toast.success('Image uploaded')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-label">
        {label}
      </span>
      <div
        className={cn('relative grid place-items-center overflow-hidden rounded-md border border-dashed border-input bg-muted', aspect)}
        onDragOver={(e) => !disabled && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (!disabled) void pick(e.dataTransfer.files[0])
        }}
      >
        {value ? (
          <img src={value} alt="" className={cn('size-full', purpose === 'logo' ? 'object-contain p-3' : 'object-cover')} />
        ) : (
          <span className="grid justify-items-center gap-1 p-4 text-center text-caption text-muted-foreground">
            <ImagePlus className="size-5" aria-hidden />
            Drop an image or upload one
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-card/70">
            <Spinner className="size-5 text-muted-foreground" />
            <span className="sr-only">Uploading</span>
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()} aria-describedby={id}>
          <Upload aria-hidden />
          {value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => onChange(null)} aria-describedby={id}>
            <Trash2 aria-hidden />
            Remove
          </Button>
        )}
      </div>
      {description && <p className="text-caption text-muted-foreground">{description}</p>}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void pick(f)
        }}
      />
    </div>
  )
}
