import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List, Plus, Search, SearchX } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { FORM_SORT_LABEL, FORM_SORTS, FORM_STATUS_LABEL, FORM_STATUSES, type FormSort, type FormsListQuery } from '@shared/api-forms'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { FormDialogs, type FormDialog } from './forms/dialogs'
import { EmptyForms } from './forms/EmptyForms'
import { FormsGrid, FormsTable } from './forms/FormsCollection'
import { formsListQuery, useFormsView } from './forms/queries'
import { TopStrip } from './forms/TopStrip'

type StatusFilter = FormsListQuery['status']

export default function FormsPage() {
  const canEdit = useCan('forms.edit')
  const [dialog, setDialog] = useState<FormDialog>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<FormSort>('updated')
  const [view, setView] = useFormsView()
  const search = useDeferredValue(q.trim())

  const list = useQuery(formsListQuery({ q: search || undefined, status, sort }))
  const data = list.data
  const noForms = data?.total === 0
  const filtered = search !== '' || status !== 'all'

  return (
    <div className="@container grid gap-8">
      <PageHeader
        title="Forms"
        description="Every form your team has made, with status and response counts."
        actions={canEdit && <Button onClick={() => setDialog({ kind: 'new' })}><Plus aria-hidden /> New form</Button>}
      />

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
          <TopStrip strip={data?.strip} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-60">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by title"
                aria-label="Search forms by title"
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {FORM_STATUSES.map((s) => <SelectItem key={s} value={s}>{FORM_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as FormSort)}>
              <SelectTrigger className="w-44" aria-label="Sort forms"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORM_SORTS.map((s) => <SelectItem key={s} value={s}>{FORM_SORT_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <ToggleGroup
              type="single"
              variant="outline"
              value={view}
              onValueChange={(v) => v && setView(v as typeof view)}
              aria-label="View"
            >
              <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid aria-hidden /></ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view"><List aria-hidden /></ToggleGroupItem>
            </ToggleGroup>
          </div>

          {!data ? (
            <FormsSkeleton view={view} />
          ) : data.forms.length === 0 ? (
            <section className="grid justify-items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
              <SearchX className="size-8 text-muted-foreground" aria-hidden />
              <h2 className="text-subheading">No forms match</h2>
              <p className="text-body text-muted-foreground">
                {filtered ? 'Try another search, or clear the filters.' : 'Nothing to show yet.'}
              </p>
              {filtered && (
                <Button variant="outline" onClick={() => (setQ(''), setStatus('all'))}>Clear filters</Button>
              )}
            </section>
          ) : (
            <div aria-busy={list.isFetching} className={list.isPlaceholderData ? 'opacity-70 transition-opacity' : undefined}>
              {view === 'grid' ? <FormsGrid forms={data.forms} onDialog={setDialog} /> : <FormsTable forms={data.forms} onDialog={setDialog} />}
            </div>
          )}
          <p className="sr-only" role="status">
            {data && filtered ? `${data.forms.length} ${data.forms.length === 1 ? 'form' : 'forms'} found` : ''}
          </p>
        </>
      )}

      <FormDialogs dialog={dialog} onClose={() => setDialog(null)} />
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
    <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
    </div>
  )
}
