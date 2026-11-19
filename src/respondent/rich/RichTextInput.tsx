import {useEffect, useLayoutEffect, useRef, useState} from 'react';

import {SYSTEM_LABELS, type Labels} from '../../lib/intelform/form/labels';
import {isBlankHtml, isRichAnswer, plainToHtml, sanitizeRichText, type RichAnswer} from '../../lib/intelform/form/rich-text';
import {canonicalFromPastedHtml, prepareEditing, runCommand, serializeRichText} from '../../lib/intelform/form/rich-text-dom';
import {cx} from '../util';
import {RichToolbar} from './RichToolbar';
import './rich-text.css';

/**
 * A respondent's rich text answer (short or long text with "Rich text answers" on): a
 * contentEditable box with the formatting toolbar under the label. The value is `{html}` in the
 * canonical subset, or undefined when it shows no text (so "required" works as for a textarea).
 *
 * Keys: Cmd/Ctrl+B / I / U format, Cmd/Ctrl+K adds a link. Single line: Enter moves on (when the
 * layout passes onAdvance). Multi-line: Enter is a new paragraph, Shift+Enter a line break,
 * Cmd/Ctrl+Enter moves on.
 */
export interface RichTextInputProps {
  id: string;
  value: unknown;
  onChange(value: RichAnswer | undefined): void;
  inline?: boolean;
  /** Visible lines (multi-line): sets the minimum height. */
  rows?: number;
  placeholder?: string;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  onAdvance?(): void;
  labels?: Labels;
  className?: string;
}

function htmlOf(value: unknown, inline: boolean): string {
  if (isRichAnswer(value)) return value.html;
  return typeof value === 'string' ? plainToHtml(value, inline) : '';
}

export function RichTextInput(props: RichTextInputProps) {
  const {id, value, inline = false, rows = 4, placeholder, labelledBy, describedBy, invalid, required, disabled, labels = SYSTEM_LABELS, className} = props;
  const ref = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const lastEmitted = useRef<string | null>(null);
  const [empty, setEmpty] = useState(() => isBlankHtml(htmlOf(value, inline)));
  const [linkRequest, setLinkRequest] = useState(0);

  // Draw the value on mount and when it changes from outside (not on our own input).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = htmlOf(value, inline);
    if (html === lastEmitted.current) return;
    lastEmitted.current = html;
    // sanitizeRichText runs the platform's sanitizeHtml: safe to draw as markup.
    el.innerHTML = sanitizeRichText(html, {inline});
    setEmpty(isBlankHtml(html));
  }, [value, inline]);

  // Height from the rows setting; set through element.style (the CSP allows it, not style="").
  useEffect(() => {
    if (ref.current && !inline) ref.current.style.minHeight = `calc(${rows} * 1.5em + 1.5rem)`;
  }, [rows, inline]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = serializeRichText(el, {inline});
    const blank = isBlankHtml(html);
    setEmpty(blank && !el.querySelector('li'));
    const next = blank ? '' : html;
    if (next === lastEmitted.current) return;
    lastEmitted.current = next;
    propsRef.current.onChange(blank ? undefined : {html});
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'k') {
      e.preventDefault();
      setLinkRequest(n => n + 1);
      return;
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (inline) {
      e.preventDefault();
      if (e.shiftKey || e.altKey || mod) return;
      // Like a text input: one-at-a-time moves on; elsewhere Enter submits the form (Next / Submit).
      emit();
      if (propsRef.current.onAdvance) propsRef.current.onAdvance();
      else ref.current?.closest('form')?.requestSubmit();
      return;
    }
    if (mod) {
      e.preventDefault();
      propsRef.current.onAdvance?.();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = ref.current;
    if (!el || disabled) return;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? canonicalFromPastedHtml(html, {inline}) : plainToHtml(text, inline);
    if (!clean) return;
    // A single pasted paragraph goes in as inline content, so it joins the current line.
    const single = /^<p>((?:(?!<\/?p>).)*)<\/p>$/.exec(clean);
    runCommand(el, 'insertHTML', single ? single[1] : clean);
    emit();
  }

  return (
    <div className={cx('rt-field', inline ? 'rt-field-inline' : 'rt-field-block', invalid && 'rt-invalid', disabled && 'rt-disabled', className)}>
      <RichToolbar editorRef={ref} inline={inline} disabled={disabled} labels={labels} onChange={emit} linkRequest={linkRequest} />
      <div
        ref={ref}
        id={id}
        data-rich-editor=""
        className="rt-editor rt-content"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        tabIndex={disabled ? -1 : 0}
        aria-multiline={!inline}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-disabled={disabled || undefined}
        aria-placeholder={placeholder}
        data-placeholder={placeholder ?? ''}
        data-empty={empty ? '' : undefined}
        spellCheck
        onFocus={prepareEditing}
        onInput={emit}
        onBlur={emit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={e => e.preventDefault()}
      />
    </div>
  );
}
