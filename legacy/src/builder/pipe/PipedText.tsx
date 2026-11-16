import { Fragment, useMemo } from 'react'
import { PIPE_RE } from '@shared/form/logic'
import { useBuilder } from '../store'
import { chipLabel, pipeSources } from './pipe-doc'

/** Read-only text with answer chips, as the canvas shows unselected questions. */
export function PipedText({ text }: { text: string }) {
  const draft = useBuilder((s) => s.doc.draft)
  const sources = useMemo(() => pipeSources(draft), [draft])
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(PIPE_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <span key={m.index} className="mx-0.5 inline-flex items-center rounded-sm bg-accent px-1.5 align-baseline text-[0.9em] font-medium text-accent-foreground ring-1 ring-border ring-inset">
        {chipLabel(sources, m[1], m[2])}
        {m[3] ? ` · or “${m[3]}”` : ''}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <Fragment>{parts}</Fragment>
}
