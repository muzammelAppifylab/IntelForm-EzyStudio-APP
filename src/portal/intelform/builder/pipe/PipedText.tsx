import {Fragment, type ReactNode, useMemo} from 'react';

import {PIPE_RE} from '../../../../lib/intelform/form/logic';
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
