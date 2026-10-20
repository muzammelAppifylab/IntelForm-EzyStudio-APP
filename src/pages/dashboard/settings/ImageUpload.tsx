import { ImagePlus, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent } from 'react'
import { SVG_PURPOSES, type UploadPurpose } from '@shared/settings-app'
import { FieldError } from '@/components/ds/FieldError'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/components/ui/cn'
import { errorMessage } from '@/lib/api'
import { checkImage, uploadImage } from '@/pages/dashboard/settings/upload'

/**
 * Image field: preview, Upload / Replace and Remove. The value is the stored URL.
 * `shape` only changes the preview frame.
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
}: {
  label: string
  description?: string
  purpose: UploadPurpose
  value: string | null
  onChange: (url: string | null) => void
  disabled?: boolean
  shape?: 'wide' | 'square' | 'round'
  error?: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const shown = localError ?? error

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = checkImage(file, purpose)
    if (problem) return setLocalError(problem)
    setLocalError(null)
    setBusy(true)
    try {
      onChange((await uploadImage(file, purpose)).url)
    } catch (err) {
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="text-label">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            'grid shrink-0 place-items-center overflow-hidden border border-border bg-muted',
            shape === 'wide' && 'h-20 w-32 rounded-lg',
            shape === 'square' && 'size-16 rounded-lg',
            shape === 'round' && 'size-16 rounded-full',
          )}
        >
          {value ? (
            <img src={value} alt="" className={cn('size-full', shape === 'round' ? 'object-cover' : 'object-contain')} />
          ) : (
            <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
            {busy && <Spinner />}
            {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
            <span className="sr-only"> {label.toLowerCase()}</span>
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => onChange(null)}>
              <Trash2 aria-hidden />
              Remove<span className="sr-only"> {label.toLowerCase()}</span>
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={SVG_PURPOSES.includes(purpose) ? 'image/png,image/jpeg,image/webp,image/svg+xml' : 'image/png,image/jpeg,image/webp'}
          onChange={pick}
        />
      </div>
      {description && <p className="text-caption text-muted-foreground">{description}</p>}
      {shown && <FieldError id={`${id}-err`}>{shown}</FieldError>}
    </div>
  )
}
