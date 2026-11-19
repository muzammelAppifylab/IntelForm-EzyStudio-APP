import {useRef} from 'react';

import {FIELD_RENDERERS} from '../form-types/renderers';
import type {FormField} from '../lib/intelform/form/definition';
import type {Engine, TtcClock} from './engine';
import {AUTO_ADVANCE_TYPES, type ChangeMeta, isGroupField} from './types';
import {RichText} from './rich/RichText';
import {FieldError} from './ui';
import {cx} from './util';

/**
 * One question: heading (a focus target, `tabindex=-1`), description, the type's renderer and
 * its error. Input types get a <label> inside the heading; group types put the heading in
 * their fieldset legend.
 */
export interface FieldBlockProps {
  field: FormField;
  engine: Engine;
  ttc: TtcClock;
  preview: boolean;
  /** One-at-a-time: big type, question number, Enter/OK advances. */
  large?: boolean;
  number?: number;
  level?: 2 | 3;
  onAdvance?: () => void;
  /** One-at-a-time: a pointer pick on a single-choice-like field (auto-advance after 300 ms). */
  onPointerPick?: () => void;
  onAnswered?: () => void;
}

export const fieldDomId = (id: string) => `q-${id}`;

export function FieldBlock({field, engine, ttc, preview, large = false, number, level = 2, onAdvance, onPointerPick, onAnswered}: FieldBlockProps) {
  const Renderer = FIELD_RENDERERS[field.type];
  const lastPointer = useRef(0);
  const group = isGroupField(field);
  const inputId = `if-${field.id}`;
  const descId = `${inputId}-desc`;
  const errId = `${inputId}-err`;
  const error = engine.errors[field.id];
  const label = engine.pipe(field.label).trim() || engine.labels.untitledQuestion;
  const description = engine.description(field) || undefined;
  const autoAdvance = !!onPointerPick && AUTO_ADVANCE_TYPES.has(field.type);
  const H = level === 3 ? 'h3' : 'h2';

  const onChange = (value: unknown, meta?: ChangeMeta) => {
    engine.setAnswer(field.id, value, meta);
    if (meta?.silent) return;
    onAnswered?.();
    if (autoAdvance && value !== undefined && Date.now() - lastPointer.current < 1500) onPointerPick?.();
  };

  const numberBadge = number !== undefined && (
    <span aria-hidden className="rf-number">
      {number}
      <span className="rf-number-arrow">→</span>
    </span>
  );

  const heading = (
    <H
      tabIndex={-1}
      data-step-heading
      className={cx(
        'rf-heading',
        // A group's heading sits inside its <legend>: give it the same type as every other
        // question title, or it falls back to the page's own (much larger) h2 style.
        group ? cx('rf-inline', large ? 'rf-question-xl' : 'rf-question') : large ? 'rf-question-xl' : 'rf-question',
        field.hideLabel && 'rf-sr-only'
      )}
    >
      {numberBadge}
      {group ? (
        label
      ) : (
        <label
          id={`${inputId}-label`}
          htmlFor={inputId}
          className="rf-label"
          onClick={e => {
            // A rich text answer is a contentEditable box, which a <label> can't focus by itself.
            const target = document.getElementById(inputId);
            if (target?.isContentEditable) {
              e.preventDefault();
              target.focus();
            }
          }}>
          {label}
        </label>
      )}
      {!group && field.required && (
        <span aria-hidden className="rf-required">
          {' '}*
        </span>
      )}
      {autoAdvance && <span className="rf-sr-only">. {engine.labels.autoAdvanceHint}</span>}
    </H>
  );

  if (!Renderer) return null;

  return (
    <div
      id={fieldDomId(field.id)}
      data-field={field.id}
      className="rf-field"
      onPointerDownCapture={() => (lastPointer.current = Date.now())}
      onKeyDownCapture={() => (lastPointer.current = 0)}
      onFocus={() => ttc.enter(field.id)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) ttc.leave();
      }}
    >
      {!group && heading}
      {!group && description && (
        <RichText id={descId} html={description} className="rf-field-description rf-text-body rf-muted" />
      )}
      <Renderer
        field={field}
        value={engine.answers[field.id]}
        onChange={onChange}
        labels={engine.labels}
        inputId={inputId}
        describedBy={[!group && description ? descId : null, !group && error ? errId : null].filter(Boolean).join(' ') || undefined}
        invalid={!!error}
        error={group ? error : undefined}
        legend={heading}
        description={group ? description : undefined}
        large={large}
        onAdvance={onAdvance}
        preview={preview}
      />
      {!group && error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

/** Focus a field's first control (the error summary links and "focus the first invalid field"). */
export function focusField(root: HTMLElement | null, id: string, smooth = true): void {
  const block = root?.querySelector<HTMLElement>(`[data-field="${CSS.escape(id)}"]`);
  if (!block) return;
  const rich = block.querySelector<HTMLElement>('[data-rich-editor][contenteditable="true"]');
  const target =
    rich ??
    block.querySelector<HTMLElement>('input[type=radio]:checked, input[type=checkbox]:checked') ??
    block.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), textarea, select, button:not(:disabled)');
  (target ?? block.querySelector<HTMLElement>('[data-step-heading]'))?.focus({preventScroll: true});
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  block.scrollIntoView({block: 'center', behavior: smooth && !reduced ? 'smooth' : 'auto'});
}
