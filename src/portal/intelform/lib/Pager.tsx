import {useId} from 'react';

import {IconButton, Select} from '../../ui';
import {formatNumber} from '../responses/format';

export type PageTarget = 'first' | 'prev' | 'next' | 'last';

export interface PagerProps {
  /** The page shown (1-based). */
  page: number;
  /** The last page's number, or null when the total is capped ("40+ pages"). */
  lastPage: number | null;
  /** Pages known to exist past the last one counted (a capped total). */
  lastPageCapped: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Rows per page, and the choices offered. */
  size: number;
  sizes?: readonly number[];
  /** The page being loaded, so only that control shows it is busy. */
  pending: PageTarget | null;
  onGo: (to: PageTarget) => void;
  /** Left out when the list's page size is fixed: no "Rows per page" choice. */
  onSize?: (size: number) => void;
}

/** The rows-per-page choices every table offers unless it says otherwise. */
export const PAGE_SIZES = [25, 50, 100] as const;

/**
 * The dashboard's one pager (responses, contacts, forms, users): rows per page, then first /
 * previous / numbers / next / last. Paging is by keyset, so the numbers are the current page,
 * its neighbours and both ends (each one request away), never a jump into the middle by offset.
 * A list with no total (lastPage null, not capped) shows no last page.
 */
export function Pager({page, lastPage, lastPageCapped, hasPrev, hasNext, size, sizes = PAGE_SIZES, pending, onGo, onSize}: PagerProps) {
  const sizeId = useId();
  const busy = pending !== null;
  const showLast = lastPage !== null && lastPage > page;

  // Numbers: 1 … p-1 [p] p+1 … last
  const items: (number | 'gap')[] = [];
  if (page > 1) {
    items.push(1);
    if (page > 3) items.push('gap');
    if (page > 2) items.push(page - 1);
  }
  items.push(page);
  if (hasNext) {
    items.push(page + 1);
    if ((lastPage === null && lastPageCapped) || (lastPage !== null && lastPage > page + 2)) items.push('gap');
    if (lastPage !== null && lastPage > page + 1) items.push(lastPage);
  }

  const targetOf = (n: number): PageTarget | null =>
    n === 1 ? 'first' : n === page - 1 ? 'prev' : n === page + 1 ? 'next' : n === lastPage ? 'last' : null;

  const pageWord = lastPage !== null ? `Page ${formatNumber(page)} of ${formatNumber(lastPage)}` : `Page ${formatNumber(page)}${lastPageCapped ? ' of many' : ''}`;

  return (
    <div className="list-pager">
      {onSize && (
        <div className="list-pager-size">
          <label htmlFor={sizeId}>Rows per page</label>
          <Select
            id={sizeId}
            value={String(size)}
            disabled={busy}
            onChange={e => onSize(Number(e.target.value))}
            options={sizes.map(n => ({value: String(n), label: String(n)}))}
          />
        </div>
      )}

      <nav className="list-pager-nav" aria-label="Pages">
        <IconButton icon="chevrons-left" size="sm" variant="ghost" label="First page" disabled={page === 1 || busy} pending={pending === 'first'} onClick={() => onGo('first')} />
        <IconButton icon="chevron-left" size="sm" variant="ghost" label="Previous page" disabled={!hasPrev || busy} pending={pending === 'prev'} onClick={() => onGo('prev')} />

        <ol className="list-pager-numbers">
          {items.map((it, i) =>
            it === 'gap' ? (
              <li key={`gap-${i}`} className="list-pager-gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={it}>
                {it === page ? (
                  <span className="list-pager-page" aria-current="page" aria-label={pageWord}>
                    {formatNumber(it)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="list-pager-page"
                    aria-label={`Page ${formatNumber(it)}`}
                    aria-busy={pending === targetOf(it) || undefined}
                    disabled={busy || targetOf(it) === null}
                    onClick={() => {
                      const to = targetOf(it);
                      if (to) onGo(to);
                    }}>
                    {formatNumber(it)}
                  </button>
                )}
              </li>
            )
          )}
        </ol>
        <span className="list-pager-compact" aria-hidden="true">
          {pageWord}
        </span>

        <IconButton icon="chevron-right" size="sm" variant="ghost" label="Next page" disabled={!hasNext || busy} pending={pending === 'next'} onClick={() => onGo('next')} />
        <IconButton icon="chevrons-right" size="sm" variant="ghost" label="Last page" disabled={!showLast || busy} pending={pending === 'last'} onClick={() => onGo('last')} />
      </nav>
    </div>
  );
}
