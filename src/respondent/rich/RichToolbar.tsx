import {type RefObject, useEffect, useId, useRef, useState} from 'react';

import {SYSTEM_LABELS, type Labels} from '../../lib/intelform/form/labels';
import {safeLinkHref} from '../../lib/intelform/form/rich-text';
import {applyLink, EMPTY_STATE, readState, type RichCommand, type RichState, runCommand, saveRange} from '../../lib/intelform/form/rich-text-dom';
import {cx} from '../util';
import './rich-text.css';

/**
 * The formatting toolbar of a rich text box (the builder's description editor and the public
 * form's rich answers): bold, italic, underline, strikethrough, lists and a link. Buttons keep
 * the editor's selection (mousedown is prevented), show their state with aria-pressed, and the
 * link opens a one-row popover over the text (it takes no height, so nothing below it moves):
 * Enter saves, Escape or a click outside closes. No nested <form>: it sits inside the respondent's form.
 */

type IconName = 'bold' | 'italic' | 'underline' | 'strike' | 'ul' | 'ol' | 'link' | 'unlink' | 'close';

const ICONS: Record<IconName, string[]> = {
  bold: ['M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8'],
  italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
  underline: ['M6 4v6a6 6 0 0 0 12 0V4', 'M4 20h16'],
  strike: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
  ul: ['M3 12h.01', 'M3 18h.01', 'M3 6h.01', 'M8 12h13', 'M8 18h13', 'M8 6h13'],
  ol: ['M10 12h11', 'M10 18h11', 'M10 6h11', 'M4 10h2', 'M4 6h1v4', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  unlink: [
    'm18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'm5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71',
    'M8 2v3',
    'M2 8h3',
    'M16 22v-3',
    'M22 16h-3',
  ],
  close: ['M18 6 6 18', 'm6 6 12 12'],
};

function Svg({name}: {name: IconName}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name].map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

interface ButtonSpec {
  cmd: RichCommand;
  icon: IconName;
  label: keyof Labels;
  shortcut?: string;
  block?: boolean;
}

const BUTTONS: ButtonSpec[] = [
  {cmd: 'bold', icon: 'bold', label: 'bold', shortcut: 'B'},
  {cmd: 'italic', icon: 'italic', label: 'italic', shortcut: 'I'},
  {cmd: 'underline', icon: 'underline', label: 'underline', shortcut: 'U'},
  {cmd: 'strikeThrough', icon: 'strike', label: 'strikethrough'},
  {cmd: 'insertUnorderedList', icon: 'ul', label: 'bulletList', block: true},
  {cmd: 'insertOrderedList', icon: 'ol', label: 'numberedList', block: true},
];

export interface RichToolbarProps {
  editorRef: RefObject<HTMLElement | null>;
  /** Single-line box: no list buttons. */
  inline?: boolean;
  disabled?: boolean;
  labels?: Labels;
  /** Called after a command changed the content (the editor's input event also fires). */
  onChange?(): void;
  className?: string;
  /** Ask the toolbar to open the link panel (Cmd/Ctrl+K in the editor). Bump to open again. */
  linkRequest?: number;
}

export function RichToolbar({editorRef, inline, disabled, labels = SYSTEM_LABELS, onChange, className, linkRequest}: RichToolbarProps) {
  const [state, setState] = useState<RichState>(EMPTY_STATE);
  const [link, setLink] = useState<{range: Range | null; current: HTMLAnchorElement | null} | null>(null);
  const [href, setHref] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  // Pressed states follow the caret while it is in this editor.
  useEffect(() => {
    const update = () => {
      const el = editorRef.current;
      if (el) setState(prev => {
        const next = readState(el);
        return (Object.keys(next) as (keyof RichState)[]).every(k => next[k] === prev[k]) ? prev : next;
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [editorRef]);

  // Only a new request opens the panel (not the count it had when the toolbar mounted).
  const handledRequest = useRef(linkRequest);
  useEffect(() => {
    if (linkRequest === handledRequest.current) return;
    handledRequest.current = linkRequest;
    openLink();
    // Only when asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkRequest]);

  useEffect(() => {
    if (link) inputRef.current?.select();
  }, [link]);

  // A click anywhere else closes the popover without saving (the link button toggles it itself).
  useEffect(() => {
    if (!link) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || linkButtonRef.current?.contains(t)) return;
      setLink(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [link]);

  function run(cmd: RichCommand) {
    const el = editorRef.current;
    if (!el || disabled) return;
    runCommand(el, cmd);
    setState(readState(el));
    onChange?.();
  }

  function openLink() {
    const el = editorRef.current;
    if (!el || disabled) return;
    const current = readState(el).link;
    setHref(current?.getAttribute('href') ?? '');
    setError('');
    setLink({range: saveRange(el), current});
  }

  function closeLink() {
    const el = editorRef.current;
    const range = link?.range ?? null;
    setLink(null);
    if (el) {
      el.focus();
      const sel = window.getSelection();
      if (sel && range && el.contains(range.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  function saveLink() {
    const el = editorRef.current;
    if (!el || !link) return;
    const value = href.trim();
    if (!value) return removeLink();
    const safe = safeLinkHref(value);
    if (!safe) {
      setError(labels.linkInvalid);
      inputRef.current?.focus();
      return;
    }
    applyLink(el, link.range, link.current, safe);
    setLink(null);
    setState(readState(el));
    onChange?.();
  }

  function removeLink() {
    const el = editorRef.current;
    if (!el || !link) return;
    if (link.current) {
      applyLink(el, link.range, link.current, null);
      onChange?.();
    } else el.focus();
    setLink(null);
  }

  const mod = isMac ? '⌘' : 'Ctrl+';
  const errorId = `${inputId}-error`;

  return (
    <div className={cx('rt-toolbar-wrap', className)}>
      <div role="toolbar" aria-label={labels.formatting} className="rt-toolbar">
        {BUTTONS.filter(b => !(inline && b.block)).map(b => (
          <button
            key={b.cmd}
            type="button"
            className="rt-tool"
            aria-label={labels[b.label]}
            title={b.shortcut ? `${labels[b.label]} (${mod}${b.shortcut})` : labels[b.label]}
            aria-pressed={state[b.cmd]}
            disabled={disabled}
            onMouseDown={e => e.preventDefault()}
            onClick={() => run(b.cmd)}>
            <Svg name={b.icon} />
          </button>
        ))}
        <button
          ref={linkButtonRef}
          type="button"
          className="rt-tool"
          aria-label={labels.link}
          title={`${labels.link} (${mod}K)`}
          aria-pressed={!!state.link}
          aria-expanded={!!link}
          disabled={disabled}
          onMouseDown={e => e.preventDefault()}
          onClick={() => (link ? closeLink() : openLink())}>
          <Svg name="link" />
        </button>
      </div>
      {link && (
        <div
          ref={popoverRef}
          className="rt-link"
          role="group"
          aria-label={labels.link}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeLink();
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              saveLink();
            }
          }}>
          <div className={cx('rt-link-row', error && 'is-invalid')}>
            <label htmlFor={inputId} className="rt-link-label" title={labels.linkAddress}>
              <Svg name="link" />
              <span className="rt-link-label-text">{labels.linkAddress}</span>
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="rt-link-input"
              value={href}
              placeholder={labels.linkPlaceholder}
              maxLength={2048}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={e => {
                setHref(e.target.value);
                if (error) setError('');
              }}
            />
            <button type="button" className="rt-link-button rt-link-primary" title={`${labels.saveLink} (Enter)`} onClick={saveLink}>
              {labels.saveLink}
            </button>
            {link.current && (
              <button type="button" className="rt-link-icon" aria-label={labels.removeLink} title={labels.removeLink} onClick={removeLink}>
                <Svg name="unlink" />
              </button>
            )}
            <button type="button" className="rt-link-icon" aria-label={labels.cancel} title={`${labels.cancel} (Esc)`} onClick={closeLink}>
              <Svg name="close" />
            </button>
          </div>
          {error && (
            <p id={errorId} className="rt-link-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
