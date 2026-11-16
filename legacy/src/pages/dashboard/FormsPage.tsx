import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List, Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { FORM_SORT_LABEL, FORM_SORTS, FORM_STATUS_LABEL, type FormSort, type FormStatus, type FormsListQuery, type FormsStrip } from '@shared/api-forms'
import { Pagination } from '@/components/common/Pagination'
import type { NewFormState } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { FormDialogs, type FormDialog } from './forms/dialogs'
import { EmptyForms } from './forms/EmptyForms'
import { FormsGrid, FormsTable } from './forms/FormsCollection'
import { formatCount } from './forms/format'
import { Overview } from './forms/Overview'
import { formsListQuery, formsStripQuery, useFormsView } from './forms/queries'

type StatusFilter = FormsListQuery['status']

/** Live first: the forms people check most. */
const STATUS_ORDER: FormStatus[] = ['live', 'draft', 'closed']
const TODAY = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const PILL = 'focus-ring press inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-label whitespace-nowrap transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out'

export default function FormsPage() {
  const [dialog, setDialog] = useState<FormDialog>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<FormSort>('updated')
  const [page, setPage] = useState(1)
  const [view, setView] = useFormsView()
  // One request once typing pauses, not one per keystroke.
  const [search, setSearch] = useState('')
  useEffect(() => {
    const next = q.trim()
    if (next === search) return
    const t = setTimeout(() => (setSearch(next), setPage(1)), 250)
    return () => clearTimeout(t)
  }, [q, search])

  // The top bar's New form button lands here with a fresh timestamp in location state.
  const requested = (useLocation().state as NewFormState | null)?.newForm ?? null
  const [handled, setHandled] = useState<number | null>(null)
  if (requested !== null && requested !== handled) {
    setHandled(requested)
    setDialog({ kind: 'new' })
  }

  const list = useQuery(formsListQuery({ q: search || undefined, status, sort, page }))
  const data = list.data
  // A delete or close emptied the last page: step back to the new last page.
  if (data && data.page === page && page > 1 && data.forms.length === 0 && data.matched > 0) {
    setPage(Math.ceil(data.matched / data.pageSize))
  }
  const strip = useQuery(formsStripQuery).data
  const noForms = data?.total === 0
  const filtered = search !== '' || status !== 'all'
  const counts = strip?.counts

  return (
    <div className="@container grid gap-6">
      <header className="grid gap-1">
        <title>Forms</title>
        <h1 className="text-heading">Forms</h1>
        <p className="text-body-sm text-muted-foreground">
          {counts ? `${formatCount(counts.all)} ${counts.all === 1 ? 'form' : 'forms'} · ${formatCount(counts.live)} live · ` : ''}
          {TODAY}
        </p>
      </header>

      {list.isError && !data ? (
        <section role="alert" className="grid justify-items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
          <h2 className="text-subheading">Forms didn’t load</h2>
          <p className="text-body text-muted-foreground">{errorMessage(list.error)}</p>
          <Button variant="outline" onClick={() => list.refetch()}>Try again</Button>
        </section>
      ) : noForms ? (
        <EmptyForms />
      ) : (
        <>
          <Overview strip={strip} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-64 @5xl:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search forms"
                aria-label="Search forms by title"
                className="pl-9"
              />
            </div>
            <StatusFilterPills value={status} onChange={(s) => (setStatus(s), setPage(1))} counts={counts} />
            <div className="flex items-center gap-2 @5xl:ml-auto">
              <Select value={sort} onValueChange={(v) => (setSort(v as FormSort), setPage(1))}>
                <SelectTrigger className="w-auto min-w-36 gap-2 text-label" aria-label="Sort forms">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORM_SORTS.map((s) => <SelectItem key={s} value={s}>{FORM_SORT_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
              <div role="group" aria-label="View" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                {([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={label}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'focus-ring press grid size-7 cursor-pointer place-items-center rounded-md border transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out',
                      view === v ? 'border-border bg-card text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!data ? (
            <FormsSkeleton view={view} />
          ) : data.matched === 0 ? (
            <section className="grid animate-fade-up justify-items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
              <SearchX className="size-8 text-muted-foreground" aria-hidden />
              <h2 className="text-subheading">{search === '' && status !== 'all' ? `No ${FORM_STATUS_LABEL[status].toLowerCase()} forms` : 'No forms match'}</h2>
              <p className="text-body text-muted-foreground">
                {search !== '' ? 'Try another search, or clear the filters.' : status !== 'all' ? `You have no ${FORM_STATUS_LABEL[status].toLowerCase()} forms.` : 'Nothing to show yet.'}
              </p>
              {filtered && (
                <Button variant="outline" onClick={() => (setQ(''), setSearch(''), setStatus('all'), setPage(1))}>Clear filters</Button>
              )}
            </section>
          ) : (
            <div className="grid gap-4">
              <div aria-busy={list.isFetching} className={list.isPlaceholderData ? 'opacity-70 transition-opacity' : undefined}>
                {view === 'grid' ? <FormsGrid forms={data.forms} onDialog={setDialog} /> : <FormsTable forms={data.forms} onDialog={setDialog} />}
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.matched} noun="forms" onPage={setPage} />
            </div>
          )}
          <p className="sr-only" role="status">
            {data && filtered ? `${data.matched} ${data.matched === 1 ? 'form' : 'forms'} found` : ''}
          </p>
        </>
      )}

      <FormDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}

/** All / Live / Draft / Closed, each with its count, as one segmented control. */
function StatusFilterPills({ value, onChange, counts }: { value: StatusFilter; onChange(v: StatusFilter): void; counts: FormsStrip['counts'] | undefined }) {
  const options: { id: StatusFilter; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUS_ORDER.map((s) => ({ id: s, label: FORM_STATUS_LABEL[s] }))]
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(PILL, 'cursor-pointer', value === o.id ? 'border-border bg-card text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {o.label}
          {counts && <span className="tabular-nums">{formatCount(counts[o.id])}</span>}
        </button>
      ))}
    </div>
  )
}

function FormsSkeleton({ view }: { view: 'grid' | 'list' }) {
  if (view === 'list') {
    return (
      <div className="grid gap-px overflow-hidden rounded-lg border bg-card">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 rounded-none" />)}
      </div>
    )
  }
  return (
    <div className="grid gap-5 @xl:grid-cols-2 @5xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64 rounded-lg" />)}
    </div>
  )
}
