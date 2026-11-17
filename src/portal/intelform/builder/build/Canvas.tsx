import {type ReactNode, useEffect, useMemo, useRef} from 'react';
import {useDroppable} from '@dnd-kit/react';

import {type FormDefinition, LAYOUT_LABEL} from '../../../../lib/intelform/form/definition';
import {lintLogic, type LogicIssue} from '../../../../lib/intelform/form/logic';
import {Button, Icon, type IconName} from '../../../ui';
import {neighbourAfterRemoval, restoreFocusIfLost} from '../../lib/focus';
import {cn} from '../../lib/utils';
import {PipedText} from '../pipe/PipedText';
import {useBuilder, useBuilderStore} from '../store';
import {FieldCard} from './FieldCard';

export const CANVAS_END = 'canvas-end';

/** Lint issues grouped by the field (or "startScreen" / "endScreen") they belong to. Exported for tests. */
export function issuesByField(def: FormDefinition): Map<string, LogicIssue[]> {
  const map = new Map<string, LogicIssue[]>();
  for (const issue of lintLogic(def)) map.set(issue.fieldId, [...(map.get(issue.fieldId) ?? []), issue]);
  return map;
}

/** Question numbers in canvas order; section breaks get null and are not counted. Exported for tests. */
export function questionNumbers(fields: FormDefinition['fields']): (number | null)[] {
  let n = 0;
  return fields.map(f => (f.type === 'section_break' ? null : ++n));
}

/** "3 questions · 1 logic rule · One at a time". Exported for tests. */
export function canvasSummary(def: FormDefinition): string {
  const fields = def.fields.filter(f => f.type !== 'section_break').length;
  const rules = def.fields.filter(f => f.logic).length;
  const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  return `${n(fields, 'question', 'questions')} · ${n(rules, 'logic rule', 'logic rules')} · ${LAYOUT_LABEL[def.layout]}`;
}

/** Centre pane: start screen, the questions in order, end screen (PRD "Centre: canvas"). */
export function Canvas({onInsert}: {onInsert(): void}) {
  const store = useBuilderStore();
  const draft = useBuilder(s => s.doc.draft);
  const selection = useBuilder(s => s.selection);
  const readOnly = useBuilder(s => s.readOnly);
  const settingsRedirect = useBuilder(s => s.settings.afterSubmit === 'redirect');

  useFocusAfterRemoval(draft.fields);
  const issues = useMemo(() => issuesByField(draft), [draft]);
  const numbers = useMemo(() => questionNumbers(draft.fields), [draft.fields]);
  const start = draft.startScreen;

  return (
    <div
      className="if-canvas"
      onMouseDown={e => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBlank !== undefined) store.getState().select(null);
      }}>
      <div data-canvas-blank className="if-canvas-inner">
        <CanvasHeader />
        <ScreenCard
          id="start"
          selected={selection === 'start'}
          icon="play"
          kind="Start screen"
          muted={!start.enabled}
          title={start.enabled ? start.title || 'Untitled start screen' : 'Start screen is off'}
          body={start.enabled ? start.description : 'Respondents go straight to the first question. Select to turn it on.'}
          meta={start.enabled && start.minutes ? `about ${start.minutes} ${start.minutes === 1 ? 'minute' : 'minutes'}` : undefined}
          issues={issues.get('startScreen')}
        />

        {draft.fields.length === 0 ? (
          <EmptyCanvas readOnly={readOnly} onInsert={onInsert} />
        ) : (
          <ol className="if-canvas-list" aria-label="Questions">
            {draft.fields.map((f, i) => (
              <FieldCard
                key={f.id}
                field={f}
                index={i}
                number={numbers[i] ?? null}
                count={draft.fields.length}
                selected={selection === f.id}
                issues={issues.get(f.id) ?? NO_ISSUES}
              />
            ))}
          </ol>
        )}

        {draft.fields.length > 0 && !readOnly && (
          <EndDrop
            onInsert={() => {
              store.getState().select(null);
              onInsert();
            }}
          />
        )}

        <ScreenCard
          id="end"
          selected={selection === 'end'}
          icon="flag"
          kind="End screen"
          title={settingsRedirect ? 'Redirects after submit' : draft.endScreen.title || 'Untitled end screen'}
          body={settingsRedirect ? 'Set in Settings, After submit.' : draft.endScreen.message}
          issues={issues.get('endScreen')}
        />
      </div>
    </div>
  );
}

const NO_ISSUES: LogicIssue[] = [];

/**
 * A deleted question takes focus with it (its card, its ⋯ menu, or the Delete dialog that closes
 * once it is gone), dropping the keyboard to <body>. Whichever way it was deleted (Delete key,
 * the card's buttons, the settings panel, the dialog), focus moves to the question now in its
 * place, else the one before it, else "Add question" / the end screen.
 */
function useFocusAfterRemoval(fields: FormDefinition['fields']) {
  const ids = useMemo(() => fields.map(f => f.id), [fields]);
  const previous = useRef(ids);
  useEffect(() => {
    const before = previous.current;
    previous.current = ids;
    if (ids.length >= before.length) return;
    const next = neighbourAfterRemoval(before, ids);
    if (next === undefined) return;
    restoreFocusIfLost(() =>
      document.querySelector<HTMLElement>(next ? `[data-card-id="${CSS.escape(next)}"]` : '.if-canvas-empty .button, [data-card-id="end"]')
    );
  }, [ids]);
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
  issues = NO_ISSUES,
}: {
  id: 'start' | 'end';
  selected: boolean;
  icon: IconName;
  kind: string;
  title: string;
  body?: string;
  muted?: boolean;
  /** Extra detail after the title, e.g. "about 1 minute". */
  meta?: string;
  issues?: LogicIssue[];
}) {
  const store = useBuilderStore();
  return (
    <div
      role="button"
      tabIndex={0}
      data-card-id={id}
      aria-pressed={selected}
      aria-label={`${kind}: ${title}`}
      onClick={() => store.getState().select(id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          store.getState().select(id);
        }
      }}
      className={cn('if-screen-card', selected && 'is-selected')}>
      <span className="if-screen-line">
        <Icon name={icon} size={16} />
        <span className="if-screen-kind">{kind}</span>
        <span className={cn('if-screen-title if-truncate', muted && 'is-muted')}>
          {muted ? (
            title
          ) : (
            <>
              “<PipedText text={title} />”
            </>
          )}
          {meta && ` · ${meta}`}
        </span>
      </span>
      {selected && body && (
        <span className="if-screen-body">
          <PipedText text={body} />
        </span>
      )}
      {issues.map((i, n) => (
        <span key={n} className="if-chip if-chip-warning if-screen-issue">
          {i.message}
        </span>
      ))}
    </div>
  );
}

function DropZone({className, children}: {className: string; children: (isDropTarget: boolean) => ReactNode}) {
  const {ref, isDropTarget} = useDroppable({id: CANVAS_END, accept: 'palette'});
  return (
    <div ref={ref} className={cn(className, isDropTarget && 'is-drop-target')}>
      {children(isDropTarget)}
    </div>
  );
}

function EmptyCanvas({readOnly, onInsert}: {readOnly: boolean; onInsert(): void}) {
  return (
    <DropZone className="if-canvas-empty">
      {() => (
        <>
          <span className="if-canvas-empty-icon">
            <Icon name="mouse-pointer-click" size={24} />
          </span>
          <div className="if-canvas-empty-text">
            <h3>Add your first question</h3>
            <p>{readOnly ? 'This form has no questions yet.' : 'Click a question type on the left, drag one here, or press / to search for one.'}</p>
          </div>
          {!readOnly && (
            <Button variant="secondary" icon="plus" onClick={onInsert}>
              Add question
            </Button>
          )}
        </>
      )}
    </DropZone>
  );
}

function EndDrop({onInsert}: {onInsert(): void}) {
  return (
    <DropZone className="if-end-drop">
      {() => (
        <button type="button" onClick={onInsert} className="if-end-drop-button">
          <Icon name="plus" size={16} />
          Add a question
        </button>
      )}
    </DropZone>
  );
}

/** The form's name at title size, with its question and rule counts and the layout. */
function CanvasHeader() {
  const draft = useBuilder(s => s.doc.draft);
  const title = useBuilder(s => s.doc.title);
  const summary = useMemo(() => canvasSummary(draft), [draft]);
  return (
    <div data-canvas-blank className="if-canvas-head">
      <h2 data-canvas-blank className="if-canvas-title">
        {title || 'Untitled form'}
      </h2>
      <p data-canvas-blank className="if-canvas-summary" aria-label="Form summary">
        {summary}
      </p>
    </div>
  );
}
