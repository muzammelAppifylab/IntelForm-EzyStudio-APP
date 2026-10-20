import { Fragment } from 'react'
import { paragraphs } from '@shared/api-front'
import { cn } from '@/components/ui/cn'

/** Creator text as paragraphs (blank lines) and line breaks. Always text, never HTML. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('grid max-w-prose gap-4', className)}>
      {paragraphs(text).map((lines, i) => (
        <p key={i}>
          {lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  )
}
