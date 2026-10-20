import { memo, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { ArrowDown, ArrowUp, Asterisk, Copy, EllipsisVertical, GitBranch, GripVertical, Trash2, TriangleAlert } from 'lucide-react'
import type { FormField } from '@shared/form/definition'
import { FIELD_TYPE_META } from '@shared/form/field-types'
import type { LogicIssue } from '@shared/form/logic'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/components/ui/cn'
import { FIELD_ICONS } from '@/form-types/icons'
import { describeRule } from '@/builder/describe'
import { fieldName } from '@/builder/ops'
import { PipedText } from '@/builder/pipe/PipedText'
import { PipeInput } from '@/builder/pipe/PipeInput'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { FieldPreview } from './FieldPreview'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

interface Props {
  field: FormField
  index: number
  /** Question number (section breaks are not counted), or null for a section break. */
  number: number | null
  count: number
  selected: boolean
  issues: LogicIssue[]
}

/** One question on the canvas: drag handle, inline label and description, preview, rule sentence. */
export const FieldCard = memo(function FieldCard({ field, index, number, count, selected, issues }: Props) {
  const store = useBuilderStore()
  const readOnly = useBuilder((s) => s.readOnly)
  const draft = useBuilder((s) => s.doc.draft)
  const handle = useRef<HTMLButtonElement>(null)
  const { ref, isDragging, isDropTarget } = useSortable({ id: field.id, index, handle, disabled: readOnly, group: 'fields' })
  const [focusTarget, setFocusTarget] = useState<'label' | 'description' | null>(null)
  // A click on the label focuses it once; selecting the card again later (keyboard) must not.
  const [wasSelected, setWasSelected] = useState(selected)
  if (wasSelected !== selected) {
    setWasSelected(selected)
    if (!selected) setFocusTarget(null)
  }
  const Icon = FIELD_ICONS[field.type]
  const meta = FIELD_TYPE_META[field.type]
  const isSection = field.type === 'section_break'
  const name = fieldName(draft, field)
  const editable = selected && !readOnly
  const autoFocus = useBuilder((st) => st.autoFocus === field.id)
  const s = () => store.getState()

  const select = () => {
    if (!selected) s().select(field.id)
  }

  return (
    <li
      ref={ref}
      data-card-id={field.id}
      tabIndex={0}
      aria-label={`${isSection ? 'Section' : `Question ${number}`}: ${name}`}
      aria-current={selected ? 'true' : undefined}
      onFocus={select}
      onMouseDown={select}
      className={cn(
        'group relative rounded-lg border border-border bg-card outline-none transition-[box-shadow,border-color] duration-(--duration-fast)',
        'hover:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected && 'border-border-ink ring-1 ring-border-ink hover:border-border-ink',
        isDragging && 'z-10 opacity-80 shadow-pop',
        isDropTarget && !isDragging && 'border-border-ink',
        isSection && 'bg-secondary',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        {!readOnly && (
          <button
            ref={handle}
            type="button"
            className="focus-ring -ml-1 grid size-7 cursor-grab place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
            aria-label={`Reorder ${name}. Press space to pick up, arrow keys to move, space to drop.`}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
          {isSection ? 'Section break' : `${number}. ${meta.label}`}
        </span>
        {field.required && !isSection && <span className="sr-only">Required</span>}
        {field.hideLabel && <span className="text-caption text-muted-foreground">Label hidden</span>}
        <div
          className={cn(
            'ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
            selected && 'opacity-100',
            readOnly && 'hidden',
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Duplicate ${name}`} onClick={() => s().duplicate(field.id)}>
                <Copy aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate ({MOD}D)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${name}`} onClick={() => s().requestDelete(field.id)}>
                <Trash2 aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete (Delete key)</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`}>
                <EllipsisVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={index === 0} onSelect={() => s().moveBy(field.id, -1)}>
                <ArrowUp aria-hidden />
                Move up
                <DropdownMenuShortcut>{MOD}⇧↑</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => s().moveBy(field.id, 1)}>
                <ArrowDown aria-hidden />
                Move down
                <DropdownMenuShortcut>{MOD}⇧↓</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!isSection && (
                <DropdownMenuItem onSelect={() => s().updateField(field.id, (f) => void (f.required = !f.required), undefined, 'Toggle required')}>
                  <Asterisk aria-hidden />
                  {field.required ? 'Make optional' : 'Make required'}
                  <DropdownMenuShortcut>{MOD}⇧R</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => s().duplicate(field.id)}>
                <Copy aria-hidden />
                Duplicate
                <DropdownMenuShortcut>{MOD}D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => s().requestDelete(field.id)}>
                <Trash2 aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-3 px-5 pt-2 pb-5">
        <div className="grid gap-1">
          {editable ? (
            <div className="flex items-start gap-0.5 [&>div:first-child]:w-auto [&>div:first-child]:max-w-full [&>div:first-child]:min-w-[12ch]">
            <PipeInput
              variant="inline"
              ariaLabel={isSection ? 'Section title' : 'Question label'}
              placeholder={isSection ? 'Section title' : 'Type your question'}
              value={field.label}
              beforeIndex={index}
              autoFocus={focusTarget === 'label' || autoFocus}
              className={isSection ? 'text-subheading text-foreground' : 'text-question text-foreground'}
              onChange={(label) => s().updateField(field.id, (f) => void (f.label = label.slice(0, 500)), `label:${field.id}`, 'Edit label')}
            />
              {field.required && !isSection && (
                <span className="text-question text-destructive" aria-hidden>
                  *
                </span>
              )}
            </div>
          ) : (
            <p
              className={cn(isSection ? 'text-subheading' : 'text-question', 'text-foreground', !field.label && 'text-field-placeholder')}
              onMouseDown={() => setFocusTarget('label')}
            >
              {field.label ? <PipedText text={field.label} /> : isSection ? 'Untitled section' : 'Type your question'}
              {field.required && !isSection && (
                <span className="ml-0.5 text-destructive" aria-hidden>
                  *
                </span>
              )}
            </p>
          )}
          {editable ? (
            <PipeInput
              variant="inline"
              multiline
              ariaLabel="Description"
              placeholder="Description (optional)"
              value={field.description ?? ''}
              beforeIndex={index}
              autoFocus={focusTarget === 'description'}
              className="text-body-sm text-muted-foreground"
              onChange={(text) =>
                s().updateField(
                  field.id,
                  (f) => {
                    if (text) f.description = text.slice(0, 2000)
                    else delete f.description
                  },
                  `description:${field.id}`,
                  'Edit description',
                )
              }
            />
          ) : (
            field.description && (
              <p className="text-body-sm whitespace-pre-wrap text-muted-foreground" onMouseDown={() => setFocusTarget('description')}>
                <PipedText text={field.description} />
              </p>
            )
          )}
        </div>
        <FieldPreview field={field} editable={editable} />
        {field.logic && (
          <p className="flex w-fit max-w-full items-start gap-1.5 rounded-md bg-info-subtle px-2 py-1 text-caption text-info-subtle-foreground">
            <GitBranch className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{describeRule(draft, field.logic)}</span>
          </p>
        )}
        {issues.length > 0 && (
          <ul className="grid gap-1" aria-label="Warnings">
            {issues.slice(0, 3).map((issue, i) => (
              <li key={i} className="flex w-fit max-w-full items-start gap-1.5 rounded-md bg-warning-subtle px-2 py-1 text-caption text-warning-subtle-foreground">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
})
