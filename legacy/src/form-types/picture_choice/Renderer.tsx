import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Image as ImageIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { FORM_FONT, FORM_RADIUS, KEY_SELECTED, LETTERS, TILE_BASE, tileState } from '@/components/ds/tokens'
import type { FieldRendererProps } from '@/respondent/types'
import { Group } from '@/respondent/ui'
import { shuffled } from '@/respondent/util'

const COLUMNS: Record<number, string> = { 2: '@lg:grid-cols-2', 3: '@lg:grid-cols-3', 4: '@lg:grid-cols-4' }

/**
 * Image tiles with native radios (single) or checkboxes (multiple). Alt text falls back to the
 * label; letter keys pick while focus is on one of the tiles.
 */
export default function PictureChoiceRenderer(p: FieldRendererProps<'picture_choice'>) {
  const { field, value, onChange } = p
  const [seed] = useState(() => Math.floor(Math.random() * 1e9))
  const options = useMemo(() => (field.props.randomize ? shuffled(field.props.options, seed) : field.props.options), [field.props.options, field.props.randomize, seed])
  const multiple = field.props.multiple
  const selected = new Set((Array.isArray(value) ? value : []).map((a: { option: string }) => a.option))
  const gridRef = useRef<HTMLDivElement>(null)

  const toggle = (id: string, checked: boolean) => {
    let next: string[]
    if (!multiple) next = checked ? [id] : []
    else next = checked ? [...[...selected].filter((x) => x !== id), id] : [...selected].filter((x) => x !== id)
    onChange(next.length ? next.map((option) => ({ option })) : undefined)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (!(t instanceof HTMLInputElement) || e.altKey || e.ctrlKey || e.metaKey) return
    if (/^[a-z]$/i.test(e.key)) {
      const i = LETTERS.indexOf(e.key.toUpperCase())
      const o = options[i]
      if (!o) return
      e.preventDefault()
      toggle(o.id, multiple ? !selected.has(o.id) : true)
      gridRef.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus()
    } else if (multiple && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const inputs = Array.from(gridRef.current?.querySelectorAll<HTMLInputElement>('input') ?? [])
      const at = inputs.indexOf(t as HTMLInputElement)
      if (at < 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
      inputs[(at + step + inputs.length) % inputs.length]?.focus()
    }
  }

  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'text-question-xl' : undefined}>
      <div ref={gridRef} onKeyDown={onKeyDown} className={clsx('grid grid-cols-2 gap-3', COLUMNS[field.props.columns])}>
        {options.map((o, i) => {
          const checked = selected.has(o.id)
          const letter = LETTERS[i]
          return (
            <label
              key={o.id}
              data-state={checked ? 'checked' : 'unchecked'}
              className={clsx(TILE_BASE, tileState(checked), FORM_RADIUS, FORM_FONT, 'flex-col items-stretch gap-2 p-2 text-answer')}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={p.inputId}
                value={o.id}
                checked={checked}
                aria-keyshortcuts={letter}
                aria-invalid={multiple && p.invalid ? true : undefined}
                required={!multiple && field.required}
                onChange={(e) => toggle(o.id, e.target.checked)}
                className="sr-only"
              />
              <span className="relative block aspect-[4/3] overflow-hidden rounded-[min(var(--form-radius,var(--radius)),0.5rem)] bg-muted">
                {o.imageUrl ? (
                  <img src={o.imageUrl} alt={o.alt || o.label} loading="lazy" decoding="async" className="size-full object-cover" />
                ) : (
                  <ImageIcon aria-hidden className="absolute inset-0 m-auto size-8 text-muted-foreground" />
                )}
              </span>
              <span className="flex items-center gap-2 px-1 pb-1">
                {letter && (
                  <span
                    aria-hidden
                    className={clsx(
                      'grid size-6 shrink-0 place-items-center rounded-sm border text-caption font-medium',
                      checked ? KEY_SELECTED : 'border-option-border bg-option text-muted-foreground',
                    )}
                  >
                    {letter}
                  </span>
                )}
                <span className="min-w-0 flex-1 break-words">{o.label}</span>
                <Check aria-hidden strokeWidth={2.5} className={clsx('size-4.5 shrink-0 text-[color:var(--form-answer,var(--option-selected-border))]', !checked && 'invisible')} />
              </span>
            </label>
          )
        })}
      </div>
    </Group>
  )
}
