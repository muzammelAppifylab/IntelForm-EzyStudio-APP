import { useRef, useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { GripVertical, ImagePlus, ListPlus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { newOptionId } from '@shared/form/definition'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/components/ui/cn'
import { errorMessage } from '@/lib/api'
import { uploadImage } from './api'

export interface EditableOption {
  id: string
  label: string
  imageUrl?: string | null
  alt?: string
}

interface Props<O extends EditableOption> {
  options: O[]
  onChange(options: O[], key?: string): void
  readOnly: boolean
  picture?: boolean
  /** Field label, for accessible names. */
  fieldName: string
}

const MAX_OPTIONS = 200

/** Options editor (PRD "Options editor"): add, drag or move to reorder, delete, bulk paste. */
export function OptionsEditor<O extends EditableOption>({ options, onChange, readOnly, picture, fieldName }: Props<O>) {
  const [bulk, setBulk] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  const make = (label: string): O => ({ id: newOptionId(), label, ...(picture ? { imageUrl: null } : {}) }) as unknown as O

  function add(after?: number, label = '') {
    if (options.length >= MAX_OPTIONS) return toast.error(`A question can have up to ${MAX_OPTIONS} options`)
    const next = [...options]
    const at = after === undefined ? next.length : after + 1
    next.splice(at, 0, make(label))
    onChange(next)
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('input[data-option-label]')[at]?.focus())
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= options.length || from === to) return
    const next = [...options]
    const [o] = next.splice(from, 1)
    next.splice(to, 0, o)
    onChange(next)
  }

  function pasteLines(index: number, text: string): boolean {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return false
    const next = [...options]
    next[index] = { ...next[index], label: lines[0] }
    next.splice(index + 1, 0, ...lines.slice(1).map(make))
    onChange(next.slice(0, MAX_OPTIONS))
    return true
  }

  return (
    <div className="grid gap-2">
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return
          const { source } = event.operation
          if (isSortable(source)) move(source.initialIndex, source.index)
        }}
      >
        <ol ref={listRef} className="grid gap-1.5" aria-label={`Options for ${fieldName}`}>
          {options.map((o, i) => (
            <OptionRow
              key={o.id}
              option={o}
              index={i}
              count={options.length}
              readOnly={readOnly}
              picture={picture}
              onLabel={(label) => {
                const next = [...options]
                next[i] = { ...o, label }
                onChange(next, `option:${o.id}`)
              }}
              onPatch={(patch) => {
                const next = [...options]
                next[i] = { ...o, ...patch }
                onChange(next)
              }}
              onEnter={() => add(i)}
              onPaste={(text) => pasteLines(i, text)}
              onDelete={() => {
                onChange(options.filter((x) => x.id !== o.id))
                requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('input[data-option-label]')[Math.max(0, i - 1)]?.focus())
              }}
              onMove={(d) => move(i, i + d)}
            />
          ))}
        </ol>
      </DragDropProvider>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => add()}>
            <Plus aria-hidden />
            Add option
          </Button>
          {!picture && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setBulk(true)}>
              <ListPlus aria-hidden />
              Paste a list
            </Button>
          )}
        </div>
      )}
      <BulkDialog
        open={bulk}
        onOpenChange={setBulk}
        onAdd={(labels, replace) => {
          const fresh = labels.map(make)
          onChange((replace ? fresh : [...options, ...fresh]).slice(0, MAX_OPTIONS))
          setBulk(false)
          toast.success(`${labels.length} ${labels.length === 1 ? 'option' : 'options'} added`)
        }}
      />
    </div>
  )
}

function OptionRow<O extends EditableOption>({
  option,
  index,
  count,
  readOnly,
  picture,
  onLabel,
  onPatch,
  onEnter,
  onPaste,
  onDelete,
  onMove,
}: {
  option: O
  index: number
  count: number
  readOnly: boolean
  picture?: boolean
  onLabel(v: string): void
  onPatch(p: Partial<EditableOption>): void
  onEnter(): void
  onPaste(text: string): boolean
  onDelete(): void
  onMove(delta: number): void
}) {
  const handle = useRef<HTMLButtonElement>(null)
  const { ref, isDragging } = useSortable({ id: option.id, index, handle, disabled: readOnly, group: 'options' })
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const name = option.label || `Option ${index + 1}`

  return (
    <li ref={ref} className={cn('grid gap-1.5 rounded-md bg-card', isDragging && 'opacity-60 shadow-pop')}>
      <div className="flex items-center gap-1">
        {!readOnly && (
          <button
            ref={handle}
            type="button"
            className="focus-ring flex size-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
            aria-label={`Reorder ${name}. Press space to pick up, arrows to move.`}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                onMove(e.key === 'ArrowUp' ? -1 : 1)
              }
            }}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <Input
          data-option-label
          aria-label={`Option ${index + 1} label`}
          className="h-(--control-sm) text-body-sm"
          value={option.label}
          placeholder={`Option ${index + 1}`}
          maxLength={500}
          readOnly={readOnly}
          onChange={(e) => onLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onEnter()
            }
            if (e.key === 'Backspace' && option.label === '' && count > 1) {
              e.preventDefault()
              onDelete()
            }
          }}
          onPaste={(e) => {
            if (onPaste(e.clipboardData.getData('text'))) e.preventDefault()
          }}
        />
        {!readOnly && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${name}`} onClick={onDelete} disabled={count <= 1}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
      {picture && (
        <div className="ml-8 flex items-center gap-2">
          <button
            type="button"
            disabled={readOnly || uploading}
            onClick={() => file.current?.click()}
            className="focus-ring relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-input bg-muted text-muted-foreground hover:bg-accent"
            aria-label={option.imageUrl ? `Replace image for ${name}` : `Upload image for ${name}`}
          >
            {uploading ? (
              <Spinner className="size-4" />
            ) : option.imageUrl ? (
              <img src={option.imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (f.size > 5 * 1024 * 1024) return toast.error('Images must be 5 MB or smaller')
              setUploading(true)
              try {
                onPatch({ imageUrl: await uploadImage(f, 'image') })
              } catch (err) {
                toast.error(errorMessage(err))
              } finally {
                setUploading(false)
              }
            }}
          />
          <Input
            aria-label={`Alt text for ${name}`}
            className="h-(--control-sm) text-body-sm"
            placeholder="Alt text (describe the image)"
            value={option.alt ?? ''}
            maxLength={500}
            readOnly={readOnly}
            onChange={(e) => onPatch({ alt: e.target.value })}
          />
        </div>
      )}
    </li>
  )
}

function BulkDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange(o: boolean): void; onAdd(labels: string[], replace: boolean): void }) {
  const [text, setText] = useState('')
  const labels = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setText(''))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paste a list of options</DialogTitle>
          <DialogDescription>One option per line. Blank lines are skipped.</DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Options, one per line" value={text} onChange={(e) => setText(e.target.value)} className="min-h-48 text-body" placeholder={'Red\nGreen\nBlue'} />
        <DialogFooter>
          <Button variant="secondary" disabled={!labels.length} onClick={() => (onAdd(labels, true), setText(''))}>
            Replace all
          </Button>
          <Button disabled={!labels.length} onClick={() => (onAdd(labels, false), setText(''))}>
            Add {labels.length || ''} {labels.length === 1 ? 'option' : 'options'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
