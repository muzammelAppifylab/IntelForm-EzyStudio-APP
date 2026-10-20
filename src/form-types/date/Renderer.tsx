import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { formatDate, isIsoDate, type DateFormat } from '@shared/form/types/basic'
import { clsx } from 'clsx'
import type { FieldRendererProps } from '@/respondent/types'
import { TextInput } from '@/respondent/ui'
import { CONTROL_BOX } from '@/respondent/util'

const DateCalendar = lazy(() => import('@/respondent/lazy/DateCalendar'))

/** Order and separator of each display format. */
const SHAPES: Record<DateFormat, { order: ('d' | 'm' | 'y')[]; sep: string }> = {
  'DD/MM/YYYY': { order: ['d', 'm', 'y'], sep: '/' },
  'MM/DD/YYYY': { order: ['m', 'd', 'y'], sep: '/' },
  'YYYY-MM-DD': { order: ['y', 'm', 'd'], sep: '-' },
  'DD.MM.YYYY': { order: ['d', 'm', 'y'], sep: '.' },
}

function mask(raw: string, format: DateFormat): string {
  const { order, sep } = SHAPES[format]
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  let out = ''
  let pos = 0
  for (const [i, k] of order.entries()) {
    const len = k === 'y' ? 4 : 2
    const part = digits.slice(pos, pos + len)
    if (!part) break
    out += (i ? sep : '') + part
    pos += len
  }
  return out
}

function toIso(text: string, format: DateFormat): string | null {
  const { order } = SHAPES[format]
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 8) return null
  const parts: Record<string, string> = {}
  let pos = 0
  for (const k of order) {
    const len = k === 'y' ? 4 : 2
    parts[k] = digits.slice(pos, pos + len)
    pos += len
  }
  const iso = `${parts.y}-${parts.m}-${parts.d}`
  return isIsoDate(iso) ? iso : null
}

/**
 * A masked text input in the field's display format (a native date input can't be forced to
 * DD/MM/YYYY) plus a calendar popover loaded on first open. Stored as "YYYY-MM-DD".
 */
export default function DateRenderer({ field, value, onChange, labels, inputId, describedBy, invalid, onAdvance }: FieldRendererProps<'date'>) {
  const { format } = field.props
  const [text, setText] = useState(() => (typeof value === 'string' && isIsoDate(value) ? formatDate(value, format) : ''))
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const popId = useId()

  const update = (raw: string) => {
    const masked = mask(raw, format)
    setText(masked)
    if (masked === '') return onChange(undefined, { invalid: null })
    const iso = toIso(masked, format)
    if (iso) onChange(iso, { invalid: null })
    else onChange(undefined, { invalid: 'invalidDate' })
  }

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div
      ref={wrapRef}
      className="relative flex max-w-80 gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <TextInput
        id={inputId}
        inputMode="numeric"
        autoComplete="off"
        placeholder={format}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        aria-required={field.required || undefined}
        invalid={invalid}
        value={text}
        onValueChange={update}
        onAdvance={onAdvance}
        className="tabular-nums"
      />
      <span id={hintId} className="sr-only">
        {format}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-label={labels.openCalendar}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={clsx(CONTROL_BOX, 'focus-ring grid w-(--control-lg) shrink-0 cursor-pointer place-items-center border border-input bg-field px-0 text-muted-foreground hover:text-foreground')}
      >
        <CalendarDays aria-hidden className="size-5" />
      </button>
      {open && (
        <div id={popId} role="dialog" aria-label={labels.calendar} className="absolute top-full left-0 z-(--z-dropdown) mt-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-pop">
          <Suspense fallback={<div className="h-72 w-64" />}>
            <DateCalendar
              selected={typeof value === 'string' && isIsoDate(value) ? value : null}
              minDate={field.props.minDate}
              maxDate={field.props.maxDate}
              disablePast={field.props.disablePast}
              disableFuture={field.props.disableFuture}
              onSelect={(iso) => {
                setText(formatDate(iso, format))
                onChange(iso, { invalid: null })
                setOpen(false)
                buttonRef.current?.focus()
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
