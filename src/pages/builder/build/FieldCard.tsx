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
import { fieldTint } from '@/builder/type-ui'
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

  const actions = (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-md bg-card transition-opacity duration-(--duration-fast) ease-out',
        !selected && 'absolute top-1/2 right-4 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
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
  )

  const required = field.required && !isSection && (
    <span className="ml-1 text-destructive" aria-hidden>
      *
    </span>
  )

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
        'group relative rounded-lg border bg-card outline-none transition-[border-color] duration-(--duration-fast) ease-out',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected ? 'border-ring ring-1 ring-ring' : 'border-border hover:border-input',
        isDragging && 'z-10 opacity-80 shadow-pop',
        isDropTarget && !isDragging && 'border-border-ink',
        isSection && !selected && 'bg-muted',
      )}
    >
      {/* Row: handle, type icon, number, label, then the rule chip and type (or actions on hover). */}
      <div className={cn('flex min-h-[4.5rem] items-center gap-3 px-4', selected ? 'pt-4 pb-2' : 'py-3')}>
        {!readOnly && (
          <button
            ref={handle}
            type="button"
            className="focus-ring -ml-1 grid size-7 shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
            aria-label={`Reorder ${name}. Press space to pick up, arrow keys to move, space to drop.`}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md',
            selected ? 'border border-option-selected-border bg-option-selected text-option-selected-foreground' : fieldTint(field.type),
          )}
          title={meta.label}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        {/* Sans and tabular: the serif "1" read like a text cursor next to the title. */}
        <span className="w-6 shrink-0 text-center text-label text-muted-foreground tabular-nums" aria-hidden>
          {isSection ? '§' : number}
        </span>
        {field.required && !isSection && <span className="sr-only">Required</span>}

        <div className="min-w-0 flex-1">
          {editable ? (
            <div className="flex items-start gap-0.5 [&>div:first-child]:mr-0 [&>div:first-child]:w-auto [&>div:first-child]:max-w-[calc(100%+0.5rem)] [&>div:first-child]:min-w-[12ch]">
              <PipeInput
                variant="inline"
                ariaLabel={isSection ? 'Section title' : 'Question label'}
                placeholder={isSection ? 'Section title' : 'Type your question'}
                value={field.label}
                beforeIndex={index}
                autoFocus={focusTarget === 'label' || autoFocus}
                className="text-question text-foreground"
                onChange={(label) => s().updateField(field.id, (f) => void (f.label = label.slice(0, 500)), `label:${field.id}`, 'Edit label')}
              />
              {field.required && !isSection && (
                <span className="py-1 text-question text-destructive" aria-hidden>
                  *
                </span>
              )}
            </div>
          ) : (
            <p className={cn('truncate text-question text-foreground', !field.label && 'text-field-placeholder')} onMouseDown={() => setFocusTarget('label')}>
              {field.label ? <PipedText text={field.label} /> : isSection ? 'Untitled section' : 'Type your question'}
              {required}
            </p>
          )}
        </div>

        {!selected && (
          <div className="flex shrink-0 items-center gap-2 transition-opacity duration-(--duration-fast) ease-out group-focus-within:opacity-0 group-hover:opacity-0">
            {issues.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-warning-subtle px-2 py-0.5 text-caption font-medium text-warning-subtle-foreground">
                <TriangleAlert className="size-3.5" aria-hidden />
                {issues.length}
                <span className="sr-only">{issues.length === 1 ? 'warning' : 'warnings'}</span>
              </span>
            )}
            {field.logic && (
              <span className="inline-flex max-w-56 items-center gap-1 rounded-md bg-info-subtle px-2 py-0.5 text-caption font-medium text-info-subtle-foreground" title={describeRule(draft, field.logic)}>
                <GitBranch className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{describeRule(draft, field.logic)}</span>
              </span>
            )}
            <span className="hidden text-body-sm whitespace-nowrap text-muted-foreground xl:inline">{isSection ? 'Section break' : meta.label}</span>
            {field.hideLabel && <span className="sr-only">Label hidden</span>}
          </div>
        )}
        {actions}
      </div>

      {/* Inset to the title text (handle, icon, number, gaps), so description and preview line up under it. */}
      {selected && (
      <div className="grid gap-4 px-5 pt-1 pb-6 sm:pl-[8.75rem]">
        <div className="grid gap-1">
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
          {field.hideLabel && <span className="text-caption text-muted-foreground">Label hidden from respondents</span>}
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
      )}
    </li>
  )
})
