import {useMemo} from 'react';

import {cn} from '../../lib/utils';
import {useBuilder} from '../store';
import PipeEditor from './PipeEditor';
import {pipeSources} from './pipe-doc';

export interface PipeInputProps {
  value: string;
  onChange(text: string): void;
  ariaLabel: string;
  /** Only fields above this index can be piped (the rule for labels). Undefined: every field. */
  beforeIndex?: number;
  multiline?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  /**
   * "input" looks like a text box (settings panel). "inline" is text on the canvas that turns into
   * a field on hover and focus; its padding sits in a negative margin so the text stays aligned.
   */
  variant?: 'input' | 'inline';
  /** Classes for the editable text (typography). */
  className?: string;
  /** id for the editable element, so a `<label htmlFor>` can point at it. */
  id?: string;
  /** aria-describedby for the editable element (hint / error ids). */
  describedBy?: string;
  invalid?: boolean;
  onFocus?(): void;
  autoFocus?: boolean;
  /** With autoFocus: select the whole text (see PipeEditor). */
  selectOnFocus?: boolean;
  /** Rich text (descriptions): HTML value, formatting toolbar. See PipeEditor. */
  rich?: boolean;
  maxLength?: number;
  maxTextLength?: number;
}

/**
 * Text box with @ answer piping. The editor is dependency-free (a contentEditable with chip
 * nodes, see PipeEditor), so it renders at once; legacy lazy-loaded TipTap here.
 */
export function PipeInput({variant = 'input', multiline, ...rest}: PipeInputProps) {
  const draft = useBuilder(s => s.doc.draft);
  const sources = useMemo(() => pipeSources(draft, rest.beforeIndex), [draft, rest.beforeIndex]);
  const allSources = useMemo(() => pipeSources(draft), [draft]);
  const undo = useBuilder(s => s.undo);
  const redo = useBuilder(s => s.redo);
  const frame = cn('if-pipe-frame', `if-pipe-frame-${variant}`, (multiline || rest.rich) && variant === 'input' && 'if-pipe-frame-multiline');
  return (
    <PipeEditor {...rest} multiline={multiline} sources={sources} allSources={allSources} frameClassName={frame} onUndo={undo} onRedo={redo} />
  );
}
