import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, Trash2, X } from 'lucide-react'
import type { CatalogField, ResponseRow } from '@shared/api-responses'
import { Pagination } from '@/components/common/Pagination'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { columnLabel, resolveColumns } from './columns'
import { ColumnsMenu, FilterMenu } from './TableMenus'
import { ConfirmDelete } from './ConfirmDelete'
import { countryLabel, deviceLabel, formatDateTime, formatDuration, formatNumber } from './format'
import { CalendarRange } from './RangePicker'
import { csvUrl, prefsQuery, responsesListQuery, useDeleteResponses, useSavePrefs, type TableState } from './queries'

export interface TableViewProps {
  formId: string
  state: TableState
  update: (patch: Record<string, string | number | string[] | null | undefined>, opts?: { replace?: boolean }) => void
  openResponse: (id: string) => void
  activeResponseId: string | null
  empty: React.ReactNode
}

export function TableView({ formId, state, update, openResponse, activeResponseId, empty }: TableViewProps) {
  const list = useQuery(responsesListQuery(formId, state))
  const prefs = useQuery(prefsQuery(formId))
  const savePrefs = useSavePrefs(formId)
  const del = useDeleteResponses(formId)
  const canDelete = useCan('responses.delete')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [search, setSearch] = useState(state.q)

  // The box follows the URL (back button, "Clear filters"); typing is debounced into the URL.
  const [syncedQ, setSyncedQ] = useState(state.q)
  if (state.q !== syncedQ) {
    setSyncedQ(state.q)
    setSearch(state.q)
  }
  useEffect(() => {
    if (search === state.q) return
    const t = setTimeout(() => update({ q: search, page: null }, { replace: true }), 300)
    return () => clearTimeout(t)
  }, [search, state.q, update])

  const data = list.data
  const pageKey = data ? `${data.page}:${data.rows.map((r) => r.id).join()}` : ''
  // Selection is per page.
  const [selectionKey, setSelectionKey] = useState(pageKey)
  if (pageKey !== selectionKey) {
    setSelectionKey(pageKey)
    setSelected(new Set())
  }

  const fieldMap = useMemo(() => new Map((data?.fields ?? []).map((f) => [f.id, f])), [data?.fields])
  const columns = useMemo(() => resolveColumns(data?.fields ?? [], prefs.data?.columns ?? null), [data?.fields, prefs.data?.columns])
  // "View all" (?has=) always shows that question's column.
  const visible = columns.filter((c) => c.visible || c.id === state.has)

  if (list.error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Responses didn’t load</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          {errorMessage(list.error)}
          <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!data) return <TableSkeleton />
  if (data.formTotal === 0) return <>{empty}</>

  const filtered = !!(state.q || state.from || state.filter.length || state.has)
  const allOnPage = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id))
  const someOnPage = data.rows.some((r) => selected.has(r.id))

  function sortBy(id: string) {
    if (state.sort === id) update({ dir: state.dir === 'asc' ? 'desc' : 'asc', page: null })
    else update({ sort: id === 'submitted_at' ? null : id, dir: id === 'submitted_at' ? null : 'asc', page: null })
  }

  return (
    <div className="grid gap-4" aria-busy={list.isPlaceholderData}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search answers"
            aria-label="Search answers"
            className="h-(--control-sm) pl-9"
          />
        </div>
        <CalendarRange
          label="Any date"
          from={state.from}
          to={state.to}
          active={!!state.from}
          onApply={(from, to) => update({ tfrom: from, tto: to, page: null })}
          onClear={() => update({ tfrom: null, tto: null, page: null })}
        />
        <FilterMenu fields={data.fields} active={state.filter} onChange={(filter) => update({ filter, page: null })} />
        <div className="ml-auto flex items-center gap-2">
          <ColumnsMenu
            columns={columns}
            labelOf={(id) => columnLabel(id, fieldMap)}
            onChange={(cols) => savePrefs.mutate(cols)}
            onReset={() => savePrefs.mutate(resolveColumns(data.fields, null))}
          />
          <Button asChild variant="outline" size="sm">
            <a href={csvUrl(formId, state)} download>
              <Download aria-hidden />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      <ActiveFilters state={state} fields={fieldMap} update={update} />

      {selected.size > 0 && (
        <div role="region" aria-label="Selection" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-accent px-3 py-2 text-body-sm text-accent-foreground">
          <span className="font-medium tabular-nums">{formatNumber(selected.size)} selected</span>
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <a href={csvUrl(formId, state, [...selected])} download>
              <Download aria-hidden />
              Export selected
            </a>
          </Button>
          {canDelete && (
            <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSelected(v ? new Set(data.rows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              {visible.map((c) => {
                const active = state.sort === c.id
                const SortIcon = active ? (state.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <TableHead key={c.id} aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(c.id === state.has && 'bg-accent')}>
                    <button
                      type="button"
                      onClick={() => sortBy(c.id)}
                      className={cn('focus-ring -mx-1 inline-flex max-w-64 items-center gap-1 rounded-sm px-1 hover:text-foreground', active && 'text-foreground')}
                    >
                      <span className="truncate">{columnLabel(c.id, fieldMap)}</span>
                      <SortIcon className={cn('size-3.5 shrink-0', !active && 'opacity-40')} aria-hidden />
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visible.length + 1} className="py-12 text-center whitespace-normal">
                  <p className="text-body text-foreground">No responses match these filters.</p>
                  {filtered && (
                    <Button variant="link" onClick={() => update({ q: null, tfrom: null, tto: null, filter: null, has: null, page: null })}>
                      Clear filters
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((r) => (
                <TableRow
                  key={r.id}
                  data-state={selected.has(r.id) || r.id === activeResponseId ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => openResponse(r.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select response from ${formatDateTime(r.submittedAt)}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s)
                          if (v) n.add(r.id)
                          else n.delete(r.id)
                          return n
                        })
                      }
                    />
                  </TableCell>
                  {visible.map((c, i) => (
                    <TableCell key={c.id} className="max-w-72 truncate">
                      {i === 0 ? (
                        <button
                          type="button"
                          className="focus-ring max-w-full truncate rounded-sm text-left"
                          onClick={(e) => {
                            e.stopPropagation()
                            openResponse(r.id)
                          }}
                          aria-label={`Open response from ${formatDateTime(r.submittedAt)}`}
                        >
                          <Cell row={r} id={c.id} field={fieldMap.get(c.id)} />
                        </button>
                      ) : (
                        <Cell row={r} id={c.id} field={fieldMap.get(c.id)} />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        noun="responses"
        suffix={filtered && data.total !== data.formTotal && ` (filtered from ${formatNumber(data.formTotal)})`}
        alwaysShowControls
        onPage={(p) => update({ page: p > 1 ? p : null })}
      />

      <ConfirmDelete
        open={confirm}
        onOpenChange={setConfirm}
        count={selected.size}
        pending={del.isPending}
        onConfirm={() =>
          del.mutate([...selected], {
            onSuccess: () => {
              setConfirm(false)
              setSelected(new Set())
            },
          })
        }
      />
    </div>
  )
}

function Cell({ row, id, field }: { row: ResponseRow; id: string; field?: CatalogField }) {
  switch (id) {
    case 'submitted_at':
      return <span className="tabular-nums">{formatDateTime(row.submittedAt)}</span>
    case 'duration':
      return <span className="tabular-nums">{formatDuration(row.durationMs)}</span>
    case 'device':
      return <>{deviceLabel(row.device)}</>
    case 'browser':
      return <>{row.browser ?? '–'}</>
    case 'country':
      return <>{countryLabel(row.country)}</>
  }
  const v = row.cells[id]
  if (v === undefined) return <span className="text-muted-foreground">–</span>
  // The server sends a URL only for signature PNGs it stored; any other answer is plain text.
  const url = field?.type === 'signature' ? row.urls?.[id] : undefined
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-link underline underline-offset-4 hover:decoration-2" onClick={(e) => e.stopPropagation()}>
        View signature
      </a>
    )
  }
  return <span title={v.length > 40 ? v : undefined}>{v}</span>
}

function ActiveFilters({ state, fields, update }: { state: TableState; fields: Map<string, CatalogField>; update: TableViewProps['update'] }) {
  const chips: { key: string; label: string; remove: () => void }[] = []
  for (const f of state.filter) {
    const [fieldId, value] = f.split(':')
    const field = fields.get(fieldId)
    const opt = field?.options?.find((o) => o.id === value)?.label ?? (field?.type === 'country' ? countryLabel(value) : value)
    chips.push({ key: f, label: `${field?.label ?? 'Question'}: ${opt}`, remove: () => update({ filter: state.filter.filter((x) => x !== f), page: null }) })
  }
  if (state.has) {
    const field = fields.get(state.has)
    chips.push({ key: 'has', label: `Answered: ${field?.label ?? 'Question'}`, remove: () => update({ has: null, page: null }) })
  }
  if (!chips.length) return null
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <li key={c.key}>
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-card py-0.5 pr-1 pl-2.5 text-body-sm text-foreground">
            <span className="max-w-80 truncate">{c.label}</span>
            <Button variant="ghost" size="icon-xs" aria-label={`Remove filter ${c.label}`} onClick={c.remove}>
              <X aria-hidden />
            </Button>
          </span>
        </li>
      ))}
      {chips.length > 1 && (
        <li>
          <Button variant="link" size="sm" onClick={() => update({ filter: null, has: null, page: null })}>
            Clear all
          </Button>
        </li>
      )}
    </ul>
  )
}

export function TableSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading responses">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="ml-auto h-8 w-32" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 rounded-none" />
        ))}
      </div>
    </div>
  )
}

