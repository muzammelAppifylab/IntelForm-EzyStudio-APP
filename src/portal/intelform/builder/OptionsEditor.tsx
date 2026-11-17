import {useRef, useState} from 'react';
import {DragDropProvider} from '@dnd-kit/react';
import {isSortable, useSortable} from '@dnd-kit/react/sortable';

import {newOptionId} from '../../../lib/intelform/form/definition';
import {Button, Icon, IconButton, Modal, Spinner, useToast} from '../../ui';
import {errorMessage} from '../lib/api';
import {DROP_FOCUS_FRAMES, restoreFocusIfLost} from '../lib/focus';
import {cn} from '../lib/utils';
import {checkUpload, uploadImage} from './api';
import './build/controls.css';
import './build/dnd.css';

export interface EditableOption {
  id: string;
  label: string;
  imageUrl?: string | null;
  alt?: string;
}

interface Props<O extends EditableOption> {
  options: O[];
  onChange(options: O[], key?: string): void;
  readOnly: boolean;
  picture?: boolean;
  /** Field label, for accessible names. */
  fieldName: string;
}

export const MAX_OPTIONS = 200;

// ------------------------------------------------------- pure list edits --

/** Non-empty trimmed lines of pasted text. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

/** A copy with the option at `from` moved to `to`; the same list when the move is out of range. */
export function moveOption<O>(options: readonly O[], from: number, to: number): O[] {
  if (to < 0 || to >= options.length || from === to || from < 0 || from >= options.length) return [...options];
  const next = [...options];
  const [o] = next.splice(from, 1);
  next.splice(to, 0, o!);
  return next;
}

/**
 * Pasting several lines into one option's box: the first line becomes that option's label, the
 * rest become new options right after it (capped at MAX_OPTIONS). Null when the paste is a
 * single line (the browser pastes it normally).
 */
export function pasteOptionLines<O extends EditableOption>(options: readonly O[], index: number, text: string, make: (label: string) => O): O[] | null {
  const lines = splitLines(text);
  if (lines.length < 2 || !options[index]) return null;
  const next = [...options];
  next[index] = {...next[index]!, label: lines[0]!};
  next.splice(index + 1, 0, ...lines.slice(1).map(make));
  return next.slice(0, MAX_OPTIONS);
}

/** Options editor (PRD "Options editor"): add, drag or move to reorder, delete, bulk paste. */
export function OptionsEditor<O extends EditableOption>({options, onChange, readOnly, picture, fieldName}: Props<O>) {
  const [bulk, setBulk] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const toast = useToast();

  const make = (label: string): O => ({id: newOptionId(), label, ...(picture ? {imageUrl: null} : {})}) as unknown as O;
  const focusAt = (i: number) =>
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('input[data-option-label]')[i]?.focus());

  function add(after?: number, label = '') {
    if (options.length >= MAX_OPTIONS) return toast.danger(`A question can have up to ${MAX_OPTIONS} options`);
    const next = [...options];
    const at = after === undefined ? next.length : after + 1;
    next.splice(at, 0, make(label));
    onChange(next);
    focusAt(at);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= options.length || from === to) return;
    onChange(moveOption(options, from, to));
  }

  return (
    <div className="if-options-editor">
      <DragDropProvider
        onDragStart={() => document.documentElement.setAttribute('data-if-dragging', '')}
        onDragEnd={event => {
          document.documentElement.removeAttribute('data-if-dragging');
          const {source} = event.operation;
          if (!isSortable(source)) return;
          // Sorting moves the row's DOM node, dropping focus to <body> in a keyboard drag: back to its handle.
          const at = event.canceled ? source.initialIndex : source.index;
          restoreFocusIfLost(() => listRef.current?.querySelectorAll<HTMLElement>('.if-drag-handle')[at], {frames: DROP_FOCUS_FRAMES});
          if (event.canceled) return;
          move(source.initialIndex, source.index);
        }}>
        <ol ref={listRef} className="if-options-list" aria-label={`Options for ${fieldName}`}>
          {options.map((o, i) => (
            <OptionRow
              key={o.id}
              option={o}
              index={i}
              count={options.length}
              readOnly={readOnly}
              picture={picture}
              onLabel={label => {
                const next = [...options];
                next[i] = {...o, label};
                onChange(next, `option:${o.id}`);
              }}
              onPatch={patch => {
                const next = [...options];
                next[i] = {...o, ...patch};
                onChange(next);
              }}
              onEnter={() => add(i)}
              onPaste={text => {
                const next = pasteOptionLines(options, i, text, make);
                if (next) onChange(next);
                return next !== null;
              }}
              onDelete={() => {
                onChange(options.filter(x => x.id !== o.id));
                focusAt(Math.max(0, i - 1));
              }}
              onMove={d => move(i, i + d)}
            />
          ))}
        </ol>
      </DragDropProvider>
      {!readOnly && (
        <div className="if-row">
          <Button variant="secondary" size="sm" icon="plus" onClick={() => add()}>
            Add option
          </Button>
          {!picture && (
            <Button variant="ghost" size="sm" icon="list-plus" onClick={() => setBulk(true)}>
              Paste a list
            </Button>
          )}
        </div>
      )}
      <BulkDialog
        open={bulk}
        onClose={() => setBulk(false)}
        onAdd={(labels, replace) => {
          const fresh = labels.map(make);
          onChange((replace ? fresh : [...options, ...fresh]).slice(0, MAX_OPTIONS));
          setBulk(false);
          toast.success(`${labels.length} ${labels.length === 1 ? 'option' : 'options'} added`);
        }}
      />
    </div>
  );
}

function OptionRow<O extends EditableOption>({
  option,
  index,
  count,
  readOnly,
  picture,
  onLabel,
  onPatch,
  onEnter,
  onPaste,
  onDelete,
  onMove,
}: {
  option: O;
  index: number;
  count: number;
  readOnly: boolean;
  picture?: boolean;
  onLabel(v: string): void;
  onPatch(p: Partial<EditableOption>): void;
  onEnter(): void;
  onPaste(text: string): boolean;
  onDelete(): void;
  onMove(delta: number): void;
}) {
  const handle = useRef<HTMLButtonElement>(null);
  const {ref, isDragging} = useSortable({id: option.id, index, handle, disabled: readOnly, group: 'options'});
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const name = option.label || `Option ${index + 1}`;

  return (
    <li ref={ref} className={cn('if-option-row', isDragging && 'is-dragging')}>
      <div className="if-option-line">
        {!readOnly && (
          <button
            ref={handle}
            type="button"
            className="if-drag-handle"
            aria-label={`Reorder ${name}. Press space to pick up, arrows to move. Alt with an arrow key moves it at once.`}
            onKeyDown={e => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                onMove(e.key === 'ArrowUp' ? -1 : 1);
              }
            }}>
            <Icon name="grip" size={16} />
          </button>
        )}
        <input
          data-option-label
          aria-label={`Option ${index + 1} label`}
          className="if-input if-input-sm"
          value={option.label}
          placeholder={`Option ${index + 1}`}
          maxLength={500}
          readOnly={readOnly}
          onChange={e => onLabel(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            }
            if (e.key === 'Backspace' && option.label === '' && count > 1) {
              e.preventDefault();
              onDelete();
            }
          }}
          onPaste={e => {
            if (onPaste(e.clipboardData.getData('text'))) e.preventDefault();
          }}
        />
        {!readOnly && <IconButton icon="trash" size="sm" label={`Delete ${name}`} onClick={onDelete} disabled={count <= 1} />}
      </div>
      {picture && (
        <div className="if-option-picture">
          <button
            type="button"
            disabled={readOnly || uploading}
            onClick={() => file.current?.click()}
            className="if-option-thumb"
            aria-label={option.imageUrl ? `Replace image for ${name}` : `Upload image for ${name}`}>
            {uploading ? <Spinner size="sm" label="Uploading" /> : option.imageUrl ? <img src={option.imageUrl} alt="" /> : <Icon name="image-plus" size={16} />}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden
            onChange={async e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const invalid = checkUpload(f, 'image');
              if (invalid) return toast.danger(invalid);
              setUploading(true);
              try {
                onPatch({imageUrl: await uploadImage(f, 'image')});
              } catch (err) {
                toast.danger(errorMessage(err));
              } finally {
                setUploading(false);
              }
            }}
          />
          <input
            aria-label={`Alt text for ${name}`}
            className="if-input if-input-sm"
            placeholder="Alt text (describe the image)"
            value={option.alt ?? ''}
            maxLength={500}
            readOnly={readOnly}
            onChange={e => onPatch({alt: e.target.value})}
          />
        </div>
      )}
    </li>
  );
}

function BulkDialog({open, onClose, onAdd}: {open: boolean; onClose(): void; onAdd(labels: string[], replace: boolean): void}) {
  const [text, setText] = useState('');
  const labels = splitLines(text);
  const close = () => {
    setText('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Paste a list of options"
      description="One option per line. Blank lines are skipped."
      footer={
        <>
          <Button
            variant="secondary"
            disabled={!labels.length}
            onClick={() => {
              onAdd(labels, true);
              setText('');
            }}>
            Replace all
          </Button>
          <Button
            disabled={!labels.length}
            onClick={() => {
              onAdd(labels, false);
              setText('');
            }}>
            Add {labels.length || ''} {labels.length === 1 ? 'option' : 'options'}
          </Button>
        </>
      }>
      <div className="field">
        <textarea
          aria-label="Options, one per line"
          className="if-textarea if-textarea-tall"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'Red\nGreen\nBlue'}
        />
      </div>
    </Modal>
  );
}
