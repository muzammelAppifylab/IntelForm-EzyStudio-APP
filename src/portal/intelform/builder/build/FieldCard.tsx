import {memo, useRef, useState} from 'react';
import {useSortable} from '@dnd-kit/react/sortable';

import type {FormField} from '../../../../lib/intelform/form/definition';
import {FIELD_TYPE_META} from '../../../../lib/intelform/form/field-types';
import type {LogicIssue} from '../../../../lib/intelform/form/logic';
import {Icon, IconButton, Menu, Switch, Tooltip} from '../../../ui';
import {cn} from '../../lib/utils';
import {describeRule} from '../describe';
import {fieldName} from '../ops';
import {applyDescription, DESCRIPTION_LIMITS, descriptionValue} from '../description';
import {PipedText, RichPipedText} from '../pipe/PipedText';
import {PipeInput} from '../pipe/PipeInput';
import {useBuilder, useBuilderStore} from '../store';
import {fieldTint} from '../type-ui';
import {FIELD_ICON} from './field-icons';
import {FieldPreview} from './FieldPreview';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';

interface Props {
  field: FormField;
  index: number;
  /** Question number (section breaks are not counted), or null for a section break. */
  number: number | null;
  count: number;
  selected: boolean;
  issues: LogicIssue[];
}

/**
 * One question on the canvas: drag handle (pointer or keyboard: space picks up, arrows move,
 * space drops), inline label and description, a preview of the answer area, its rule sentence.
 * Keyboard alternatives to dragging: Move up / Move down in ⋯ and Ctrl+Shift+↑ / ↓.
 */
export const FieldCard = memo(function FieldCard({field, index, number, count, selected, issues}: Props) {
  const store = useBuilderStore();
  const readOnly = useBuilder(s => s.readOnly);
  const draft = useBuilder(s => s.doc.draft);
  const handle = useRef<HTMLButtonElement>(null);
  const {ref, isDragging, isDropTarget} = useSortable({id: field.id, index, handle, disabled: readOnly, group: 'fields'});
  const [focusTarget, setFocusTarget] = useState<'label' | 'description' | null>(null);
  // A click on the label focuses it once; selecting the card again later (keyboard) must not.
  const [wasSelected, setWasSelected] = useState(selected);
  if (wasSelected !== selected) {
    setWasSelected(selected);
    if (!selected) setFocusTarget(null);
  }
  const meta = FIELD_TYPE_META[field.type];
  const isSection = field.type === 'section_break';
  const name = fieldName(draft, field);
  const editable = selected && !readOnly;
  const autoFocus = useBuilder(st => st.autoFocus === field.id);
  const s = () => store.getState();
  const rule = field.logic ? describeRule(draft, field.logic) : null;

  const select = () => {
    if (!selected) s().select(field.id);
  };

  const actions = !readOnly && (
    <div className={cn('if-card-actions', !selected && 'is-hover')}>
      <Tooltip content={`Duplicate (${MOD}D)`}>
        <IconButton icon="copy" size="sm" label={`Duplicate ${name}`} onClick={() => s().duplicate(field.id)} />
      </Tooltip>
      <Tooltip content="Delete (Delete key)">
        <IconButton icon="trash" size="sm" label={`Delete ${name}`} onClick={() => s().requestDelete(field.id)} />
      </Tooltip>
      <Menu
        label={`More actions for ${name}`}
        items={[
          {label: `Move up (${MOD}Shift+↑)`, icon: 'arrow-up', disabled: index === 0, onSelect: () => s().moveBy(field.id, -1)},
          {label: `Move down (${MOD}Shift+↓)`, icon: 'arrow-down', disabled: index === count - 1, onSelect: () => s().moveBy(field.id, 1)},
          'separator',
          ...(isSection
            ? []
            : [
                {
                  label: `${field.required ? 'Make optional' : 'Make required'} (${MOD}Shift+R)`,
                  icon: 'asterisk' as const,
                  onSelect: () => s().updateField(field.id, f => void (f.required = !f.required), undefined, 'Toggle required'),
                },
              ]),
          {label: `Duplicate (${MOD}D)`, icon: 'copy', onSelect: () => s().duplicate(field.id)},
          {label: 'Delete', icon: 'trash', danger: true, onSelect: () => s().requestDelete(field.id)},
        ]}
      />
    </div>
  );

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
        'if-field-card',
        selected && 'is-selected',
        isDragging && 'is-dragging',
        isDropTarget && !isDragging && 'is-drop-target',
        isSection && 'is-section'
      )}>
      {/* Row: handle, type icon, number, label, then the rule chip and type (or actions on hover). */}
      <div className="if-card-row">
        {!readOnly && (
          <button
            ref={handle}
            type="button"
            className="if-drag-handle"
            aria-label={`Reorder ${name}. Press space to pick up, arrow keys to move, space to drop.`}>
            <Icon name="grip" size={16} />
          </button>
        )}
        {/* One badge: the type's icon and the question number (section breaks have no number). */}
        <span className={cn('if-type-tile if-card-badge', selected ? 'is-selected' : fieldTint(field.type))} title={meta.label}>
          <Icon name={FIELD_ICON[field.type]} size={14} />
          {!isSection && (
            <span className="if-card-number" aria-hidden="true">
              {number}
            </span>
          )}
        </span>
        {field.required && !isSection && <span className="visually-hidden">Required</span>}

        <div className="if-card-label">
          {editable ? (
            <div className="if-card-label-edit">
              <PipeInput
                variant="inline"
                ariaLabel={isSection ? 'Section title' : 'Question label'}
                placeholder={isSection ? 'Section title' : 'Type your question'}
                value={field.label}
                beforeIndex={index}
                autoFocus={focusTarget === 'label' || autoFocus}
                className="if-question-text"
                onChange={label => s().updateField(field.id, f => void (f.label = label.slice(0, 500)), `label:${field.id}`, 'Edit label')}
              />
              {field.required && !isSection && (
                <span className="if-required" aria-hidden="true">
                  *
                </span>
              )}
            </div>
          ) : (
            <p className={cn('if-question-text if-truncate', !field.label && 'is-placeholder')} onMouseDown={() => setFocusTarget('label')}>
              {field.label ? <PipedText text={field.label} /> : isSection ? 'Untitled section' : 'Type your question'}
              {field.required && !isSection && (
                <span className="if-required" aria-hidden="true">
                  *
                </span>
              )}
            </p>
          )}
        </div>

        {!selected && (
          <div className="if-card-meta">
            {issues.length > 0 && (
              <span className="if-chip if-chip-warning">
                <Icon name="warning" size={14} />
                {issues.length}
                <span className="visually-hidden">{issues.length === 1 ? 'warning' : 'warnings'}</span>
              </span>
            )}
            {rule && (
              <span className="if-chip if-chip-info if-chip-rule" title={rule}>
                <Icon name="git-branch" size={14} />
                <span className="if-truncate">{rule}</span>
              </span>
            )}
            <span className="if-card-type">{isSection ? 'Section break' : meta.label}</span>
            {field.hideLabel && <span className="visually-hidden">Label hidden</span>}
          </div>
        )}
        {actions}
      </div>

      {/* Inset to the title text (handle, icon, number), so description and preview line up under it. */}
      {selected && (
        <div className="if-card-body">
          <div className="if-card-description">
            {editable ? (
              <PipeInput
                variant="inline"
                rich
                {...DESCRIPTION_LIMITS}
                ariaLabel="Description"
                placeholder="Description (optional)"
                value={descriptionValue(field)}
                beforeIndex={index}
                autoFocus={focusTarget === 'description'}
                className="if-description-text"
                onChange={html => s().updateField(field.id, f => applyDescription(f, html), `description:${field.id}`, 'Edit description')}
              />
            ) : (
              field.description && (
                <div onMouseDown={() => setFocusTarget('description')}>
                  <RichPipedText html={descriptionValue(field)} className="if-description-text" />
                </div>
              )
            )}
            {field.hideLabel && <span className="if-caption">Label hidden from respondents</span>}
          </div>
          <div className="if-card-answer">
            <FieldPreview field={field} editable={editable} />
          </div>
          {rule && (
            <p className="if-chip if-chip-info if-chip-block">
              <Icon name="git-branch" size={14} />
              <span>{rule}</span>
            </p>
          )}
          {issues.length > 0 && (
            <ul className="if-card-issues" aria-label="Warnings">
              {issues.slice(0, 3).map((issue, i) => (
                <li key={i} className="if-chip if-chip-warning if-chip-block">
                  <Icon name="warning" size={14} />
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* Footer of the open card: what it is, and the one setting changed most often (Required). */}
      {selected && (
        <div className="if-card-foot">
          <span className="if-card-foot-type">
            <Icon name={FIELD_ICON[field.type]} size={14} />
            {isSection ? 'Section break' : meta.label}
          </span>
          {!isSection && !readOnly && (
            <div className="if-card-foot-required">
              <Switch
                label="Required"
                checked={field.required}
                onChange={v => s().updateField(field.id, f => void (f.required = v), undefined, 'Toggle required')}
              />
            </div>
          )}
          {!isSection && readOnly && field.required && <span className="if-card-foot-type">Required</span>}
        </div>
      )}
    </li>
  );
});
