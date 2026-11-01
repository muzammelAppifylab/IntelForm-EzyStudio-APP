import { lazy, Suspense, useMemo } from 'react'
import { cn } from '@/components/ui/cn'
import { useBuilder } from '../store'
import { pipeSources } from './pipe-doc'

const PipeEditor = lazy(() => import('./PipeEditor'))

export interface PipeInputProps {
  value: string
  onChange(text: string): void
  ariaLabel: string
  /** Only fields above this index can be piped (the rule for labels). Undefined: every field. */
  beforeIndex?: number
  multiline?: boolean
  placeholder?: string
  readOnly?: boolean
  /**
   * "input" looks like a text box (settings panel). "inline" is text on the canvas that turns into
   * a field on hover and focus; its padding sits in a negative margin so the text stays aligned.
   */
  variant?: 'input' | 'inline'
  className?: string
  onFocus?(): void
  autoFocus?: boolean
}

const FRAME = {
  input:
    'w-full cursor-text rounded-md border border-input bg-field px-3 py-2 text-body transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
  inline:
    '-mx-2 w-[calc(100%+1rem)] cursor-text rounded-md px-2 py-1 transition-[background-color,box-shadow] duration-(--duration-fast) ease-out hover:bg-accent focus-within:bg-field focus-within:ring-2 focus-within:ring-ring hover:focus-within:bg-field',
}

/** Text box with @ answer piping. Shows a plain input while the editor chunk loads. */
export function PipeInput({ variant = 'input', multiline, className, ...rest }: PipeInputProps) {
  const draft = useBuilder((s) => s.doc.draft)
  const sources = useMemo(() => pipeSources(draft, rest.beforeIndex), [draft, rest.beforeIndex])
  const allSources = useMemo(() => pipeSources(draft), [draft])
  const frame = cn(FRAME[variant], multiline && variant === 'input' && 'min-h-20')
  return (
    <Suspense
      fallback={
        <div className={frame}>
          <span className={cn('block whitespace-pre-wrap', className, !rest.value && 'text-field-placeholder')}>{rest.value || rest.placeholder || ' '}</span>
        </div>
      }
    >
      <PipeEditor {...rest} multiline={multiline} sources={sources} allSources={allSources} className={className} frameClassName={frame} />
    </Suspense>
  )
}
