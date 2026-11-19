import {Fragment, type ReactNode, useMemo} from 'react';

import {PIPE_RE} from '../../../../lib/intelform/form/logic';
import {decodeEntities, escapeHtml, sanitizeRichText} from '../../../../lib/intelform/form/rich-text';
import '../../../../respondent/rich/rich-text.css';
import './pipe-rich.css';
import {useBuilder} from '../store';
import {chipLabel, pipeSources} from './pipe-doc';
import './pipe.css';

/** Read-only text with answer chips, as the canvas shows unselected questions. */
export function PipedText({text}: {text: string}) {
  const draft = useBuilder(s => s.doc.draft);
  const sources = useMemo(() => pipeSources(draft), [draft]);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PIPE_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} className="if-pipe-chip">
        {chipLabel(sources, m[1], m[2])}
        {m[3] ? ` · or “${m[3]}”` : ''}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}

/**
 * Read-only rich text (a description) with answer chips, as the canvas shows unselected
 * questions. The HTML is sanitized first; the chips added after it are built from escaped text.
 */
export function RichPipedText({html, className}: {html: string; className?: string}) {
  const draft = useBuilder(s => s.doc.draft);
  const sources = useMemo(() => pipeSources(draft), [draft]);
  const markup = useMemo(
    () =>
      sanitizeRichText(html).replace(PIPE_RE, (_m, id: string, part: string | undefined, fallback: string | undefined) => {
        const label = escapeHtml(chipLabel(sources, id, part));
        const fb = fallback ? escapeHtml(` · or “${decodeEntities(fallback)}”`) : '';
        return `<span class="if-pipe-chip">${label}${fb}</span>`;
      }),
    [html, sources]
  );
  return <div className={`rt-content if-rich-preview ${className ?? ''}`} dangerouslySetInnerHTML={{__html: markup}} />;
}
