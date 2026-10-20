import { useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import { Eraser, Keyboard, PenLine } from 'lucide-react'
import { clsx } from 'clsx'
import type { FieldRendererProps } from '../types'
import { TextInput } from '../ui'

/**
 * Signature (lazy chunk: signature_pad). Draw with a pointer, or type your name for a keyboard
 * alternative (WCAG 2.1.1); either way the answer is a PNG data URL the server uploads.
 * Dark ink on a light "paper" in every theme, so the stored image reads anywhere.
 */
const MAX_RATIO = 2

function ink(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--palette-ink-950').trim() || 'black'
}

export default function SignatureCanvas({ value, onChange, labels, inputId, invalid, describedBy }: FieldRendererProps<'signature'>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [typed, setTyped] = useState('')
  const signed = !!value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const canvas = canvasRef.current!
    const pad = new SignaturePad(canvas, { penColor: ink(), minWidth: 0.8, maxWidth: 2.6 })
    padRef.current = pad
    pad.addEventListener('endStroke', () => onChangeRef.current({ url: pad.toDataURL('image/png') }))
    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO)
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      const data = pad.toData()
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.getContext('2d')!.scale(ratio, ratio)
      pad.clear()
      if (data.length) pad.fromData(data)
    }
    fit()
    const initial = (value as { url?: string } | undefined)?.url
    if (initial?.startsWith('data:image/png')) void pad.fromDataURL(initial, { ratio: Math.min(window.devicePixelRatio || 1, MAX_RATIO) })
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      pad.off()
    }
    // Mount only: the pad owns the drawing after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const pad = padRef.current
    if (!pad) return
    if (mode === 'type') pad.off()
    else pad.on()
  }, [mode])

  const clear = () => {
    padRef.current?.clear()
    setTyped('')
    onChange(undefined)
  }

  const drawTyped = (text: string) => {
    setTyped(text)
    const canvas = canvasRef.current!
    const pad = padRef.current!
    pad.clear()
    if (!text.trim()) return onChange(undefined)
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas.getBoundingClientRect()
    let size = Math.min(48, height * 0.45)
    const family = getComputedStyle(canvas).fontFamily
    ctx.save()
    ctx.fillStyle = ink()
    ctx.textBaseline = 'middle'
    do {
      ctx.font = `italic 500 ${size}px ${family}`
      size -= 2
    } while (ctx.measureText(text).width > width - 32 && size > 12)
    ctx.fillText(text, 16, height / 2)
    ctx.restore()
    onChange({ url: canvas.toDataURL('image/png') })
  }

  return (
    <div className="grid gap-2">
      <div className={clsx('relative h-44 overflow-hidden rounded-[min(var(--form-radius,var(--radius)),0.75rem)] border bg-paper-50', invalid ? 'border-destructive' : 'border-input')}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={signed ? labels.signed : labels.signHere}
          className={clsx('block size-full touch-none', mode === 'draw' ? 'cursor-crosshair' : 'pointer-events-none')}
        />
        {!signed && mode === 'draw' && (
          <span aria-hidden className="pointer-events-none absolute inset-x-4 bottom-4 border-t border-dashed border-paper-300 pt-1 text-caption text-paper-700">
            {labels.signHere}
          </span>
        )}
      </div>
      {mode === 'type' && (
        <TextInput
          id={inputId}
          autoComplete="name"
          aria-label={labels.typeToSign}
          aria-describedby={describedBy}
          value={typed}
          onValueChange={drawTyped}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode(mode === 'draw' ? 'type' : 'draw')}
          className="focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-label text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {mode === 'draw' ? <Keyboard aria-hidden className="size-4" /> : <PenLine aria-hidden className="size-4" />}
          {mode === 'draw' ? labels.typeInstead : labels.drawInstead}
        </button>
        <button
          type="button"
          id={mode === 'draw' ? inputId : undefined}
          onClick={clear}
          aria-describedby={mode === 'draw' ? describedBy : undefined}
          className="focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-label text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Eraser aria-hidden className="size-4" />
          {labels.clear}
        </button>
      </div>
    </div>
  )
}
