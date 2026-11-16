import { useRef } from 'react'
import { Angry, CalendarDays, ChevronDown, Clock, Frown, ImageIcon, Laugh, Meh, Plus, Smile, Star, X } from 'lucide-react'

const FACES = [Angry, Frown, Meh, Smile, Laugh]
import { newOptionId, type FormField } from '@shared/form/definition'
import { ADDRESS_LINES, countryName } from '@shared/form/types/registry'
import { cn } from '@/components/ui/cn'
import { useBuilderStore } from '@/builder/store'

/** A quiet, non-interactive look at the answer area, so the canvas reads like the form. */
function Box({ children, className, tall }: { children?: React.ReactNode; className?: string; tall?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 rounded-md border border-input bg-field px-3 text-body-sm text-field-placeholder', tall ? 'min-h-20 items-start py-2' : 'h-10', className)}>
      {children}
    </div>
  )
}

const ADDRESS_LABEL: Record<string, string> = { street: 'Street address', line2: 'Address line 2', city: 'City', state: 'State / province', postal: 'Postal code', country: 'Country' }

export function FieldPreview({ field, editable }: { field: FormField; editable: boolean }) {
  const placeholder = field.placeholder || 'Type your answer here'
  switch (field.type) {
    case 'section_break':
      return null
    case 'short_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'number':
      return (
        <Box>
          <span className="truncate">
            {field.type === 'number' && field.props.prefix}
            {field.placeholder || { email: 'name@example.com', phone: '+1 555 000 0000', url: 'https://', number: '0', short_text: placeholder }[field.type]}
            {field.type === 'number' && field.props.suffix}
          </span>
        </Box>
      )
    case 'long_text':
      return <Box tall>{placeholder}</Box>
    case 'name':
      return field.props.split ? (
        <div className="grid grid-cols-2 gap-2">
          <Box>First name</Box>
          <Box>Last name</Box>
        </div>
      ) : (
        <Box>{field.placeholder || 'Full name'}</Box>
      )
    case 'address':
      return (
        <div className="grid grid-cols-2 gap-2">
          {ADDRESS_LINES.filter((l) => field.props.lines[l]).map((l) => (
            <Box key={l} className={l === 'street' || l === 'line2' ? 'col-span-2' : undefined}>
              {ADDRESS_LABEL[l]}
            </Box>
          ))}
        </div>
      )
    case 'country':
    case 'dropdown':
      return (
        <Box>
          <span className="truncate">
            {field.type === 'country' && field.props.defaultCountry ? countryName(field.props.defaultCountry) : field.placeholder || 'Choose an option'}
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        </Box>
      )
    case 'date':
      return (
        <Box className="w-56">
          {field.props.format}
          <CalendarDays className="size-4" aria-hidden />
        </Box>
      )
    case 'time':
      return (
        <Box className="w-40">
          {field.props.hourCycle === '12' ? 'hh:mm AM' : 'HH:mm'}
          <Clock className="size-4" aria-hidden />
        </Box>
      )
    case 'single_choice':
    case 'multiple_choice':
      return <OptionsPreview field={field} editable={editable} />
    case 'yes_no':
      return (
        <div className="flex gap-2">
          {[field.props.yesLabel, field.props.noLabel].map((l, i) => (
            <span key={i} className="rounded-md border border-option-border bg-option px-4 py-2 text-body-sm text-foreground">
              {l}
            </span>
          ))}
        </div>
      )
    case 'picture_choice':
      return (
        <div className={cn('grid gap-2', { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[field.props.columns])}>
          {field.props.options.slice(0, 8).map((o, i) => (
            <div key={o.id} className="overflow-hidden rounded-md border border-option-border bg-option">
              <div className="grid aspect-[4/3] place-items-center bg-muted text-muted-foreground">
                {o.imageUrl ? <img src={o.imageUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="size-5" aria-hidden />}
              </div>
              <p className="truncate px-2 py-1.5 text-caption text-foreground">{o.label || `Option ${i + 1}`}</p>
            </div>
          ))}
        </div>
      )
    case 'rating':
      return (
        <div className="grid gap-1">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: field.props.scale }, (_, i) =>
              field.props.style === 'stars' ? (
                <Star key={i} className="size-6 text-rating-empty" />
              ) : (
                <span key={i} className="grid size-8 place-items-center rounded-md border border-option-border bg-option text-caption text-foreground">
                  {field.props.style === 'numbers' ? i + 1 : <Face index={i} scale={field.props.scale} />}
                </span>
              ),
            )}
          </div>
          {(field.props.leftLabel || field.props.rightLabel) && (
            <div className="flex justify-between text-caption text-muted-foreground" style={{ width: `${field.props.scale * 2.375}rem` }}>
              <span>{field.props.leftLabel}</span>
              <span>{field.props.rightLabel}</span>
            </div>
          )}
        </div>
      )
    case 'nps':
      return (
        <div className="grid max-w-md gap-1">
          <div className="grid grid-cols-11 gap-1" aria-hidden>
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className="grid h-8 place-items-center rounded-md border border-option-border bg-option text-caption text-foreground">
                {i}
              </span>
            ))}
          </div>
          <div className="flex justify-between text-caption text-muted-foreground">
            <span>{field.props.lowLabel}</span>
            <span>{field.props.highLabel}</span>
          </div>
        </div>
      )
    case 'signature':
      return <Box tall className="min-h-24 items-end justify-center pb-3">Sign here</Box>
    case 'consent':
      return (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <span className="mt-0.5 size-4 shrink-0 rounded-sm border border-input bg-field" aria-hidden />
          <span>
            {field.props.text}
            {field.props.link && <span className="ml-1 text-link underline">{field.props.link.label}</span>}
          </span>
        </label>
      )
  }
}

function Face({ index, scale }: { index: number; scale: number }) {
  const Icon = FACES[Math.round((index / Math.max(1, scale - 1)) * 4)]
  return <Icon className="size-4 text-muted-foreground" />
}

/** Options for single and multiple choice; option labels are edited right here when selected. */
function OptionsPreview({ field, editable }: { field: Extract<FormField, { type: 'single_choice' | 'multiple_choice' }>; editable: boolean }) {
  const store = useBuilderStore()
  const list = useRef<HTMLUListElement>(null)
  const round = field.type === 'single_choice'
  const marker = <span className={cn('size-4 shrink-0 border border-input bg-field', round ? 'rounded-full' : 'rounded-sm')} aria-hidden />

  const update = (recipe: (opts: { id: string; label: string }[]) => void, key?: string, label = 'Edit options') =>
    store.getState().updateField(field.id, (f) => recipe((f.props as { options: { id: string; label: string }[] }).options), key, label)

  const focusOption = (i: number) => requestAnimationFrame(() => list.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus())

  return (
    <ul ref={list} className={cn('grid gap-1.5', field.props.orientation === 'horizontal' && 'flex flex-wrap')} aria-label="Options">
      {field.props.options.map((o, i) => (
        <li key={o.id} className="group/opt flex items-center gap-2.5 rounded-md border border-option-border bg-option px-3 py-2">
          {marker}
          {editable ? (
            <>
              <input
                aria-label={`Option ${i + 1}`}
                value={o.label}
                placeholder={`Option ${i + 1}`}
                maxLength={500}
                className="min-w-0 flex-1 bg-transparent text-body-sm text-foreground outline-none placeholder:text-field-placeholder"
                onChange={(e) => update((opts) => void (opts[i].label = e.target.value), `option:${o.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    update((opts) => void opts.splice(i + 1, 0, { id: newOptionId(), label: '' }), undefined, 'Add option')
                    focusOption(i + 1)
                  }
                  if (e.key === 'Backspace' && o.label === '' && field.props.options.length > 1) {
                    e.preventDefault()
                    update((opts) => void opts.splice(i, 1), undefined, 'Delete option')
                    focusOption(Math.max(0, i - 1))
                  }
                }}
              />
              {field.props.options.length > 1 && (
                <button
                  type="button"
                  aria-label={`Delete option ${o.label || i + 1}`}
                  className="focus-ring rounded-sm p-0.5 text-muted-foreground opacity-0 group-hover/opt:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                  onClick={() => update((opts) => void opts.splice(i, 1), undefined, 'Delete option')}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </>
          ) : (
            <span className="text-body-sm text-foreground">{o.label || `Option ${i + 1}`}</span>
          )}
        </li>
      ))}
      {field.props.other && (
        <li className="flex items-center gap-2.5 rounded-md border border-dashed border-option-border px-3 py-2 text-body-sm text-muted-foreground">
          {marker}
          Other
        </li>
      )}
      {editable && field.props.options.length < 200 && (
        <li>
          <button
            type="button"
            className="focus-ring flex items-center gap-1.5 rounded-sm px-1 py-1 text-body-sm text-link hover:underline"
            onClick={() => {
              update((opts) => void opts.push({ id: newOptionId(), label: '' }), undefined, 'Add option')
              focusOption(field.props.options.length)
            }}
          >
            <Plus className="size-4" aria-hidden />
            Add option
          </button>
        </li>
      )}
    </ul>
  )
}
