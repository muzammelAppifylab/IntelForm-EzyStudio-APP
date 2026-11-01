import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

const numberFmt = new Intl.NumberFormat()
const fmt = (n: number) => numberFmt.format(n)

export interface PaginationProps {
  /** 1-based. */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  /** Plural noun for an empty list: "No forms". */
  noun: string
  /** Appended to the range, e.g. " (filtered from 1,204)". */
  suffix?: ReactNode
  /** Show the page controls even on a single page. */
  alwaysShowControls?: boolean
}

/** "1–50 of 312 · Page 1 of 7 ‹ ›" under a paged list. */
export function Pagination({ page, pageSize, total, onPage, noun, suffix, alwaysShowControls }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-muted-foreground">
      <span className="tabular-nums" aria-live="polite">
        {total === 0 ? `No ${noun}` : `${fmt(first)}–${fmt(last)} of ${fmt(total)}`}
        {suffix}
      </span>
      {(pages > 1 || alwaysShowControls) && (
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Page {fmt(page)} of {fmt(pages)}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </nav>
  )
}
