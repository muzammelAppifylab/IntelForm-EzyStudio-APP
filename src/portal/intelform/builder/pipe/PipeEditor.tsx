import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {PIPE_RE, pipeToken} from '../../../../lib/intelform/form/logic';
import {htmlToPlain, isBlankHtml, plainToHtml, sanitizeRichText} from '../../../../lib/intelform/form/rich-text';
import {canonicalFromPastedHtml, prepareEditing, runCommand, serializeRichText} from '../../../../lib/intelform/form/rich-text-dom';
import {RichToolbar} from '../../../../respondent/rich/RichToolbar';
import {Button} from '../../../ui';
import {cn} from '../../lib/utils';
import {chipLabel, filterSources, PIPE_NODE, textToDoc, type PipeSource} from './pipe-doc';
import './pipe.css';
import './pipe-rich.css';

export interface PipeEditorProps {
  value: string;
  onChange(text: string): void;
  /** Answers offered by @ (earlier fields only). */
  sources: PipeSource[];
  /** Every field, so chips for any reference get a readable label. */
  allSources: PipeSource[];
  multiline?: boolean;
  ariaLabel: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Classes for the editable text (typography). */
  className?: string;
  /** Classes for the frame around it. */
  frameClassName?: string;
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  onFocus?(): void;
  /** Focus the end of the text once mounted. */
  autoFocus?: boolean;
  /** With autoFocus: select the whole text, so typing replaces it (a new question's starter title). */
  selectOnFocus?: boolean;
  /**
   * Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (or Ctrl+Y) inside the editor. The builder passes its own
   * undo / redo, so typing undoes like the rest of the canvas. Without them the keys do nothing
   * (the browser's own undo can't follow chip edits).
   */
  onUndo?(): void;
  onRedo?(): void;
  /**
   * Rich text (a question description): the value is sanitized HTML with pipe tokens in its
   * text, and a formatting toolbar sits above the box. Always multi-line.
   */
  rich?: boolean;
  /** Rich text: the longest HTML (formatting included) and visible text it may save. */
  maxLength?: number;
  maxTextLength?: number;
}

interface MenuState {
  items: PipeSource[];
  index: number;
  rect: {top: number; bottom: number; left: number} | null;
  /** The text node and offsets of "@query" being typed. */
  node: Text;
  from: number;
  to: number;
}

const CHIP_CLASS = 'if-pipe-chip';

const isChip = (n: Node | null): n is HTMLElement => n instanceof HTMLElement && n.dataset.pipeId !== undefined;

function chipText(sources: readonly PipeSource[], id: string, part: string | null, fallback: string | null) {
  const label = chipLabel(sources, id, part);
  return {
    text: `${label}${fallback ? ` · or “${fallback}”` : ''}`,
    title: `Shows the answer to ${label}${fallback ? `, or “${fallback}” when empty` : ''}. Click to set the fallback.`,
  };
}

function makeChip(sources: readonly PipeSource[], id: string, part: string | null, fallback: string | null): HTMLElement {
  const chip = document.createElement('span');
  chip.className = CHIP_CLASS;
  chip.contentEditable = 'false';
  chip.dataset.pipeId = id;
  if (part) chip.dataset.pipePart = part;
  if (fallback) chip.dataset.pipeFallback = fallback;
  const {text, title} = chipText(sources, id, part, fallback);
  chip.textContent = text;
  chip.title = title;
  return chip;
}

/** Turns the pipe tokens in the element's text nodes into chips (rich text is drawn as HTML first). */
function chipify(el: HTMLElement, sources: readonly PipeSource[]) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes('{')) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(PIPE_RE)) {
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
      frag.append(makeChip(sources, m[1], m[2] ?? null, m[3] ?? null));
      last = m.index + m[0].length;
    }
    if (last === 0) continue;
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  }
}

/** Draws rich text HTML with chips. sanitizeRichText runs the platform's sanitizeHtml first. */
function renderRich(el: HTMLElement, html: string, sources: readonly PipeSource[]) {
  el.innerHTML = sanitizeRichText(html);
  chipify(el, sources);
}

const chipToken = (node: HTMLElement): string | null =>
  isChip(node) ? pipeToken(node.dataset.pipeId!, node.dataset.pipePart || undefined, node.dataset.pipeFallback || undefined) : null;

/** Draws `text` into the editable element: text nodes, chips, '\n' as text (white-space: pre-wrap). */
function render(el: HTMLElement, text: string, multiline: boolean, sources: readonly PipeSource[]) {
  el.replaceChildren();
  const doc = textToDoc(text, multiline);
  (doc.content ?? []).forEach((p, i) => {
    if (i > 0) el.append(document.createTextNode('\n'));
    for (const n of p.content ?? []) {
      if (n.type === PIPE_NODE) {
        const a = n.attrs ?? {};
        el.append(makeChip(sources, String(a.id), (a.part as string | null) ?? null, (a.fallback as string | null) ?? null));
      } else if (n.type === 'text' && n.text) {
        el.append(document.createTextNode(n.text));
      }
    }
  });
  // Keeps a trailing newline visible and gives the caret a place after a final chip.
  const sentinel = document.createElement('br');
  sentinel.dataset.sentinel = '';
  el.append(sentinel);
}

/** The stored text of the editable element (chips back to `{f_x.part|fallback}` tokens). */
function serialize(el: HTMLElement): string {
  let out = '';
  const walk = (parent: Node) => {
    parent.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node as Text).data;
      } else if (isChip(node)) {
        out += pipeToken(node.dataset.pipeId!, node.dataset.pipePart || undefined, node.dataset.pipeFallback || undefined);
      } else if (node instanceof HTMLBRElement) {
        if (node.dataset.sentinel === undefined) out += '\n';
      } else if (node instanceof HTMLElement) {
        // Blocks a browser may insert (a pasted or typed <div>): a new line before their text.
        const block = node.tagName === 'DIV' || node.tagName === 'P';
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(node);
      }
    });
  };
  walk(el);
  return out;
}

function caretRect(range: Range): MenuState['rect'] {
  const r = range.getBoundingClientRect();
  if (r.top === 0 && r.left === 0 && r.bottom === 0) {
    const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const box = node?.getBoundingClientRect();
    return box ? {top: box.top, bottom: box.bottom, left: box.left} : null;
  }
  return {top: r.top, bottom: r.bottom, left: r.left};
}

/**
 * Text with answer-piping chips (PRD Logic → Answer piping). `@` lists earlier answers; picking
 * one inserts a chip and asks for a fallback. Stored as plain text tokens via pipeToken().
 * A plain contentEditable (no editor library): chips are non-editable spans, the text is read
 * back on every input, and outside changes (undo, another panel) redraw it.
 */
export default function PipeEditor(props: PipeEditorProps) {
  const {value, multiline: multilineProp = false, rich = false, ariaLabel, placeholder, readOnly, className, frameClassName} = props;
  const multiline = multilineProp || rich;
  const listboxId = useId();
  const fallbackId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const lastEmitted = useRef<string | null>(null);
  const composing = useRef(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [empty, setEmpty] = useState(!value);
  const [fallbackChip, setFallbackChip] = useState<HTMLElement | null>(null);
  const [fallback, setFallback] = useState('');
  const [tooLong, setTooLong] = useState(false);
  const [linkRequest, setLinkRequest] = useState(0);

  // Draw on mount, and whenever the value changes from outside (undo, another panel).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === lastEmitted.current) return;
    lastEmitted.current = value;
    const focused = document.activeElement === el;
    if (rich) renderRich(el, value, propsRef.current.allSources);
    else render(el, value, multiline, propsRef.current.allSources);
    setEmpty(!value);
    setTooLong(false);
    // Redrawn while typing here (undo / redo): keep the caret in the text, at its end.
    if (focused) focusEnd();
    // focusEnd only reads the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, multiline, rich]);

  // Chip labels follow renamed questions without touching the text.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>(`.${CHIP_CLASS}`).forEach(chip => {
      const {text, title} = chipText(
        props.allSources,
        chip.dataset.pipeId!,
        chip.dataset.pipePart ?? null,
        chip.dataset.pipeFallback ?? null
      );
      if (chip.textContent !== text) chip.textContent = text;
      chip.title = title;
    });
  }, [props.allSources]);

  useEffect(() => {
    if (props.autoFocus && !readOnly) requestAnimationFrame(() => (props.selectOnFocus ? focusAll() : focusEnd()));
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The menu sits at the caret: computed positions go through element.style (the CSP allows it).
  useLayoutEffect(() => {
    const el = menuEl.current;
    if (!el || !menu?.rect) return;
    const width = el.offsetWidth || 288;
    el.style.top = `${Math.round(menu.rect.bottom + 6)}px`;
    el.style.left = `${Math.round(Math.max(8, Math.min(menu.rect.left, window.innerWidth - width - 8)))}px`;
  }, [menu]);

  function focusAll() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function focusEnd() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const sentinel = el.querySelector('br[data-sentinel]');
    if (sentinel) {
      range.setStartBefore(sentinel);
      range.collapse(true);
    } else {
      range.selectNodeContents(el);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function emit() {
    const el = ref.current;
    if (!el) return;
    let text: string;
    if (rich) {
      const html = serializeRichText(el, {atom: chipToken});
      text = isBlankHtml(html) ? '' : html;
      setEmpty(!text && !el.querySelector('li'));
      const {maxLength, maxTextLength} = propsRef.current;
      const over =
        (maxLength !== undefined && text.length > maxLength) || (maxTextLength !== undefined && htmlToPlain(text).length > maxTextLength);
      setTooLong(over);
      // Too long to save: keep what's on screen (the message says so), save nothing until it fits.
      if (over) return;
    } else {
      text = serialize(el);
      if (!multiline && text.includes('\n')) text = text.replace(/\s*\n\s*/g, ' ');
      setEmpty(!text);
    }
    if (text === lastEmitted.current) return;
    lastEmitted.current = text;
    propsRef.current.onChange(text);
  }

  /** Opens, updates or closes the @ menu from the caret position. */
  function updateMenu() {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount || !sel.isCollapsed || composing.current || document.activeElement !== el) {
      if (menuRef.current) setMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      if (menuRef.current) setMenu(null);
      return;
    }
    const before = (node as Text).data.slice(0, range.startOffset);
    const m = /(^|\s)@([^\s@]{0,40})$/.exec(before);
    if (!m) {
      if (menuRef.current) setMenu(null);
      return;
    }
    const from = range.startOffset - m[2].length - 1;
    const items = filterSources(propsRef.current.sources, m[2]);
    const prev = menuRef.current;
    setMenu({
      items,
      index: prev && prev.node === node && prev.from === from ? Math.min(prev.index, Math.max(0, items.length - 1)) : 0,
      rect: caretRect(range),
      node: node as Text,
      from,
      to: range.startOffset,
    });
  }

  function pick(item: PipeSource) {
    const m = menuRef.current;
    const el = ref.current;
    if (!m || !el || !el.contains(m.node)) return setMenu(null);
    const range = document.createRange();
    range.setStart(m.node, m.from);
    range.setEnd(m.node, Math.min(m.to, m.node.length));
    range.deleteContents();
    const chip = makeChip(propsRef.current.allSources, item.fieldId, item.part ?? null, null);
    range.insertNode(chip);
    const sel = window.getSelection();
    const after = document.createRange();
    after.setStartAfter(chip);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    setMenu(null);
    emit();
    setFallback('');
    setFallbackChip(chip);
  }

  function insertText(text: string) {
    const sel = window.getSelection();
    const el = ref.current;
    if (!sel || !sel.rangeCount || !el) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    el.normalize();
    emit();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const m = menuRef.current;
    if (m) {
      const n = m.items.length;
      if (e.key === 'ArrowDown' && n) {
        e.preventDefault();
        return setMenu({...m, index: (m.index + 1) % n});
      }
      if (e.key === 'ArrowUp' && n) {
        e.preventDefault();
        return setMenu({...m, index: (m.index - 1 + n) % n});
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && n) {
        e.preventDefault();
        return pick(m.items[m.index]);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return setMenu(null);
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) propsRef.current.onRedo?.();
      else propsRef.current.onUndo?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      propsRef.current.onRedo?.();
      return;
    }
    if (rich && mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setLinkRequest(n => n + 1);
      return;
    }
    // Rich-text shortcuts (bold, italic, underline) make no sense in stored plain text.
    if (!rich && mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      // Rich text: the browser makes the new paragraph (Shift+Enter: a line break).
      if (rich && !mod) return;
      e.preventDefault();
      if (multiline && !mod) insertText('\n');
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const chip = target.closest?.(`.${CHIP_CLASS}`) as HTMLElement | null;
    if (chip && !propsRef.current.readOnly && ref.current?.contains(chip)) {
      e.preventDefault();
      setFallback(chip.dataset.pipeFallback ?? '');
      setFallbackChip(chip);
    }
  }

  function applyFallback() {
    const chip = fallbackChip;
    if (chip && ref.current?.contains(chip)) {
      const v = fallback.replace(/[{}|]/g, '').trim();
      if (v) chip.dataset.pipeFallback = v;
      else delete chip.dataset.pipeFallback;
      const {text, title} = chipText(propsRef.current.allSources, chip.dataset.pipeId!, chip.dataset.pipePart ?? null, v || null);
      chip.textContent = text;
      chip.title = title;
      emit();
    }
    closeFallback();
  }

  function closeFallback() {
    const chip = fallbackChip;
    setFallbackChip(null);
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (chip && el.contains(chip)) {
      const sel = window.getSelection();
      const after = document.createRange();
      after.setStartAfter(chip);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
    }
  }

  const fallbackLabel = fallbackChip
    ? chipLabel(props.allSources, fallbackChip.dataset.pipeId!, fallbackChip.dataset.pipePart ?? null)
    : '';
  const activeId = menu && menu.items.length ? `${listboxId}-${menu.index}` : undefined;

  return (
    <div className={cn('if-pipe', rich && 'if-pipe-rich')}>
      {rich && !readOnly && <RichToolbar editorRef={ref} onChange={emit} linkRequest={linkRequest} className="if-pipe-toolbar" />}
      <div className={frameClassName} onClick={() => !readOnly && document.activeElement !== ref.current && focusEnd()}>
        <div
          ref={ref}
          id={props.id}
          className={cn('if-pipe-editor', multiline && 'if-pipe-editor-multiline', rich && 'if-pipe-editor-rich rt-content', className)}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          role="textbox"
          tabIndex={readOnly ? 0 : undefined}
          aria-label={ariaLabel}
          aria-multiline={multiline}
          aria-readonly={readOnly || undefined}
          aria-invalid={props.invalid || tooLong || undefined}
          aria-describedby={props.describedBy}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={!!menu}
          aria-controls={menu ? listboxId : undefined}
          aria-activedescendant={activeId}
          data-placeholder={placeholder ?? ''}
          data-empty={empty ? '' : undefined}
          spellCheck
          onInput={() => {
            emit();
            updateMenu();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={e => {
            if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) || !menuRef.current) updateMenu();
          }}
          onClick={onClick}
          onFocus={() => {
            if (rich) prepareEditing();
            propsRef.current.onFocus?.();
          }}
          onBlur={() => setMenu(null)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => {
            composing.current = false;
            emit();
            updateMenu();
          }}
          onPaste={e => {
            e.preventDefault();
            if (readOnly) return;
            if (rich) {
              const el = ref.current;
              const pasted = e.clipboardData.getData('text/html');
              const plain = e.clipboardData.getData('text/plain');
              const clean = pasted ? canonicalFromPastedHtml(pasted) : plainToHtml(plain);
              if (!el || !clean) return;
              // One pasted paragraph joins the current line instead of starting a new one.
              const single = /^<p>((?:(?!<\/?p>).)*)<\/p>$/.exec(clean);
              runCommand(el, 'insertHTML', single ? single[1] : clean);
              chipify(el, propsRef.current.allSources);
              emit();
              return;
            }
            const text = e.clipboardData.getData('text/plain');
            insertText(multiline ? text.replace(/\r\n?/g, '\n') : text.replace(/\s*\n\s*/g, ' '));
          }}
          onDrop={e => e.preventDefault()}
        />
      </div>

      {tooLong && (
        <p className="field-error if-pipe-too-long" role="alert">
          This is too long to save. Shorten it{props.maxTextLength ? ` to ${props.maxTextLength.toLocaleString()} characters` : ''} or remove some
          formatting.
        </p>
      )}
      {fallbackChip && (
        <div className="if-pipe-fallback" role="dialog" aria-labelledby={`${fallbackId}-title`}>
          <form
            noValidate
            onSubmit={e => {
              e.preventDefault();
              applyFallback();
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeFallback();
              }
            }}>
            <div className="field">
              <label htmlFor={fallbackId} id={`${fallbackId}-title`}>
                Fallback text
              </label>
              <input
                id={fallbackId}
                autoFocus
                value={fallback}
                onChange={e => setFallback(e.target.value)}
                placeholder="e.g. there"
                maxLength={60}
                aria-describedby={`${fallbackId}-hint`}
              />
              <p className="field-hint" id={`${fallbackId}-hint`}>
                Shown instead of {fallbackLabel || 'the answer'} when it is empty. Leave blank to show nothing.
              </p>
            </div>
            <div className="if-pipe-fallback-actions">
              <Button variant="ghost" size="sm" onClick={closeFallback}>
                Skip
              </Button>
              <Button type="submit" size="sm">
                Save fallback
              </Button>
            </div>
          </form>
        </div>
      )}

      {menu &&
        createPortal(
          <div ref={menuEl} className="if-pipe-menu">
            <p className="if-pipe-menu-title">Insert an earlier answer</p>
            <ul id={listboxId} role="listbox" aria-label="Earlier answers">
              {menu.items.length === 0 && (
                <li role="presentation" className="if-pipe-menu-empty">
                  {props.sources.length ? 'No answers match' : 'No earlier questions to show answers from'}
                </li>
              )}
              {menu.items.map((item, i) => (
                <li
                  key={`${item.fieldId}.${item.part ?? ''}`}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={i === menu.index}
                  className={cn('if-pipe-option', i === menu.index && 'is-active', item.part && 'is-part')}
                  onMouseDown={e => {
                    e.preventDefault();
                    pick(item);
                  }}
                  onMouseEnter={() => setMenu({...menu, index: i})}>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
