import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/react'
import { Flag, MousePointerClick, Play, Plus } from 'lucide-react'
import { LAYOUT_LABEL } from '@shared/form/definition'
import { lintLogic, type LogicIssue } from '@shared/form/logic'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { PipedText } from '@/builder/pipe/PipedText'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { FieldCard } from './FieldCard'

export const CANVAS_END = 'canvas-end'

/** Centre pane: start screen, the questions in order, end screen (PRD "Centre: canvas"). */
export function Canvas({ onInsert }: { onInsert(): void }) {
  const store = useBuilderStore()
  const draft = useBuilder((s) => s.doc.draft)
  const selection = useBuilder((s) => s.selection)
  const readOnly = useBuilder((s) => s.readOnly)
  const settingsRedirect = useBuilder((s) => s.settings.afterSubmit === 'redirect')

  const issuesByField = useMemo(() => {
    const map = new Map<string, LogicIssue[]>()
    for (const issue of lintLogic(draft)) map.set(issue.fieldId, [...(map.get(issue.fieldId) ?? []), issue])
    return map
  }, [draft])

  const numbers = useMemo(() => {
    let n = 0
    return draft.fields.map((f) => (f.type === 'section_break' ? null : ++n))
  }, [draft.fields])

  return (
    <div
      className="h-full min-h-0 overflow-y-auto rounded-lg bg-background"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBlank !== undefined) store.getState().select(null)
      }}
    >
      <div data-canvas-blank className="mx-auto grid max-w-[56rem] grid-cols-[minmax(0,1fr)] gap-4 px-6 pt-6 pb-36">
        <CanvasHeader />
        <ScreenCard
          id="start"
          selected={selection === 'start'}
          icon={<Play className="size-4" aria-hidden />}
          kind="Start screen"
          muted={!draft.startScreen.enabled}
          title={draft.startScreen.enabled ? draft.startScreen.title || 'Untitled start screen' : 'Start screen is off'}
          body={draft.startScreen.enabled ? draft.startScreen.description : 'Respondents go straight to the first question. Select to turn it on.'}
          meta={draft.startScreen.enabled && draft.startScreen.minutes ? `about ${draft.startScreen.minutes} ${draft.startScreen.minutes === 1 ? 'minute' : 'minutes'}` : undefined}
        />

        {draft.fields.length === 0 ? (
          <EmptyCanvas readOnly={readOnly} onInsert={onInsert} />
        ) : (
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="Questions">
            {draft.fields.map((f, i) => (
              <FieldCard key={f.id} field={f} index={i} number={numbers[i]} count={draft.fields.length} selected={selection === f.id} issues={issuesByField.get(f.id) ?? []} />
            ))}
          </ol>
        )}

        {draft.fields.length > 0 && !readOnly && (
          <EndDrop
            onInsert={() => {
              store.getState().select(null)
              onInsert()
            }}
          />
        )}

        <ScreenCard
          id="end"
          selected={selection === 'end'}
          icon={<Flag className="size-4" aria-hidden />}
          kind="End screen"
          title={settingsRedirect ? 'Redirects after submit' : draft.endScreen.title || 'Untitled end screen'}
          body={settingsRedirect ? 'Set in Settings, After submit.' : draft.endScreen.message}
          issues={[...(issuesByField.get('endScreen') ?? [])]}
        />
      </div>
    </div>
  )
}

function ScreenCard({
  id,
  selected,
  icon,
  kind,
  title,
  body,
  muted,
  meta,
  issues = [],
}: {
  id: 'start' | 'end'
  selected: boolean
  icon: React.ReactNode
  kind: string
  title: string
  body?: string
  muted?: boolean
  /** Extra detail after the title, e.g. "about 1 minute". */
  meta?: string
  issues?: LogicIssue[]
}) {
  const store = useBuilderStore()
  return (
    <div
      role="button"
      tabIndex={0}
      data-card-id={id}
      aria-pressed={selected}
      aria-label={`${kind}: ${title}`}
      onClick={() => store.getState().select(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          store.getState().select(id)
        }
      }}
      className={cn(
        'focus-ring grid cursor-pointer gap-2 rounded-lg border border-dashed border-input px-6 py-4 text-left transition-[border-color,background-color] duration-(--duration-fast) ease-out hover:border-muted-foreground',
        selected && 'border-solid border-border-ink bg-card hover:border-border-ink',
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-foreground">{icon}</span>
        <span className="shrink-0 text-label font-semibold text-foreground">{kind}</span>
        <span className={cn('min-w-0 truncate text-body text-muted-foreground', muted && 'italic')}>
          {muted ? title : <>“<PipedText text={title} />”</>}
          {meta && ` · ${meta}`}
        </span>
      </span>
      {selected && body && (
        <span className="line-clamp-2 pl-7 text-body-sm whitespace-pre-wrap text-muted-foreground">
          <PipedText text={body} />
        </span>
      )}
      {issues.map((i, n) => (
        <span key={n} className="ml-7 w-fit rounded-md bg-warning-subtle px-2 py-1 text-caption text-warning-subtle-foreground">
          {i.message}
        </span>
      ))}
    </div>
  )
}

function EmptyCanvas({ readOnly, onInsert }: { readOnly: boolean; onInsert(): void }) {
  const { ref, isDropTarget } = useDroppable({ id: CANVAS_END, accept: 'palette' })
  return (
    <div
      ref={ref}
      className={cn(
        'grid place-items-center gap-3 rounded-lg border border-dashed border-input px-6 py-14 text-center',
        isDropTarget && 'border-border-ink bg-accent',
      )}
    >
      <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-foreground">
        <MousePointerClick className="size-6" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="grid gap-1">
        <h2 className="text-subheading text-foreground">Add your first question</h2>
        <p className="max-w-sm text-body text-muted-foreground">
          {readOnly ? 'This form has no questions yet.' : 'Click a question type on the left, drag one here, or press / to search for one.'}
        </p>
      </div>
      {!readOnly && (
        <Button onClick={onInsert} variant="secondary">
          <Plus aria-hidden />
          Add question
        </Button>
      )}
    </div>
  )
}

function EndDrop({ onInsert }: { onInsert(): void }) {
  const { ref, isDropTarget } = useDroppable({ id: CANVAS_END, accept: 'palette' })
  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={onInsert}
        className={cn(
          'focus-ring press flex h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-input text-label text-foreground transition-[border-color,background-color,scale] duration-(--duration-fast) ease-out hover:border-muted-foreground hover:bg-card',
          isDropTarget && 'border-border-ink bg-option-selected',
        )}
      >
        <Plus className="size-4" aria-hidden />
        Add a question
      </button>
    </div>
  )
}

/** The form's name at title size, with its question and rule counts and the layout. */
function CanvasHeader() {
  const draft = useBuilder((s) => s.doc.draft)
  const title = useBuilder((s) => s.doc.title)
  const { fields, rules } = useMemo(
    () => ({ fields: draft.fields.filter((f) => f.type !== 'section_break').length, rules: draft.fields.filter((f) => f.logic).length }),
    [draft],
  )
  const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`
  return (
    <div data-canvas-blank className="grid gap-1 pb-2">
      <h1 data-canvas-blank className="text-heading break-words xl:text-title">
        {title || 'Untitled form'}
      </h1>
      <p data-canvas-blank className="text-body text-muted-foreground" aria-label="Form summary">
        {n(fields, 'question', 'questions')} · {n(rules, 'logic rule', 'logic rules')} · {LAYOUT_LABEL[draft.layout]}
      </p>
    </div>
  )
}
