import { useQuery } from '@tanstack/react-query'
import { Contact, Download, SearchX } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { CONTACTS_PAGE_SIZE, type ContactRow, type ContactSort } from '@shared/api-contacts'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState } from '@/components/ds/EmptyState'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { BulkBar, CollectionSkeleton, ContactsCards, ContactsTable } from './contacts/Collection'
import { ConfirmDeleteContacts } from './contacts/ConfirmDelete'
import { ContactSheet } from './contacts/ContactSheet'
import { FiltersButton } from './contacts/Filters'
import { contactTitle, plural } from './contacts/format'
import {
  CLEAR_FILTERS,
  contactsCsvUrl,
  contactsListQuery,
  contactsOverviewQuery,
  defaultDir,
  isFiltered,
  useContactsUrl,
  useContactsView,
  useDeleteContacts,
  useHiddenColumns,
  type AdvancedFilters,
} from './contacts/queries'
import { Strip } from './contacts/Strip'
import { ActiveFilters, ColumnsMenu, SearchBox, SegmentPills, SortControls, ViewToggle } from './contacts/Toolbar'

/** Under 640px the table becomes cards. */
const NARROW = '(max-width: 639px)'
const subscribeNarrow = (cb: () => void) => {
  const mql = window.matchMedia(NARROW)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false)

/** What the delete dialog is about to erase. */
interface DeleteTarget {
  keys: string[]
  responses: number
  name?: string
}

/**
 * Dashboard → Contacts: everyone who answered a form with an email or phone, grouped per person.
 * Filters, segment, sort, page and the open contact (?contact=<key>) live in the URL; the view
 * (table or cards) and hidden columns are remembered in this browser.
 */
export default function ContactsPage() {
  const { state, contactKey, update } = useContactsUrl()
  const [chosenView, setView] = useContactsView()
  const narrow = useNarrow()
  const view = narrow ? 'cards' : chosenView
  const [hidden, setHidden] = useHiddenColumns()
  const canDelete = useCan('responses.delete')
  const del = useDeleteContacts()

  // The search box follows the URL (back button, "Clear filters"); typing reaches the URL deferred and debounced.
  const [q, setQ] = useState(state.q)
  const [syncedQ, setSyncedQ] = useState(state.q)
  if (state.q !== syncedQ) {
    setSyncedQ(state.q)
    setQ(state.q)
  }
  const deferredQ = useDeferredValue(q.trim())
  useEffect(() => {
    if (deferredQ === state.q) return
    const t = setTimeout(() => update({ q: deferredQ, page: null }, { replace: true }), 250)
    return () => clearTimeout(t)
  }, [deferredQ, state.q, update])

  const list = useQuery(contactsListQuery(state))
  const data = list.data
  const overview = useQuery(contactsOverviewQuery).data

  // Selection survives paging, and is cleared whenever the filters or sort change.
  const [selected, setSelected] = useState<Map<string, ContactRow>>(() => new Map())
  const filterSig = JSON.stringify({ ...state, page: 0 })
  const [selectionSig, setSelectionSig] = useState(filterSig)
  if (filterSig !== selectionSig) {
    setSelectionSig(filterSig)
    setSelected(new Map())
  }
  const select = useCallback((rows: ContactRow[], on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const r of rows) {
        if (on) next.set(r.key, r)
        else next.delete(r.key)
      }
      return next
    })
  }, [])

  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const askDelete = canDelete
    ? (rows: ContactRow[]) =>
        setDeleting({ keys: rows.map((r) => r.key), responses: rows.reduce((n, r) => n + r.responseCount, 0), name: rows.length === 1 ? contactTitle(rows[0]!) : undefined })
    : null

  function confirmDelete() {
    if (!deleting) return
    const keys = deleting.keys
    del.mutate(keys, {
      onSuccess: () => {
        setDeleting(null)
        setSelected((prev) => {
          const next = new Map(prev)
          keys.forEach((k) => next.delete(k))
          return next
        })
        const patch: Record<string, null | number> = {}
        if (contactKey && keys.includes(contactKey)) patch.contact = null
        // The whole page went: step back one.
        if (data && state.page > 1 && data.contacts.every((c) => keys.includes(c.key))) patch.page = state.page - 1 > 1 ? state.page - 1 : null
        if (Object.keys(patch).length) update(patch, { replace: true })
      },
    })
  }

  const csvFor = useCallback((keys: string[]) => contactsCsvUrl(state, keys), [state])
  const openContact = useCallback((key: string) => update({ contact: key }), [update])
  const closeContact = useCallback(() => update({ contact: null }), [update])

  const setFilters = (patch: Partial<Record<keyof AdvancedFilters, string[] | string | number | null | undefined>>) => update({ ...patch, page: null })
  const applyFilters = (f: AdvancedFilters) => setFilters({ form: f.form, country: f.country, has: f.has, from: f.from ?? null, to: f.to ?? null, min: f.min ?? null, max: f.max ?? null })
  function sortBy(s: ContactSort) {
    if (s === state.sort) update({ dir: state.dir === 'asc' ? 'desc' : 'asc', page: null })
    else update({ sort: s === 'last_seen' ? null : s, dir: null, page: null })
  }
  const setDir = (d: 'asc' | 'desc') => update({ dir: d === defaultDir(state.sort) ? null : d, page: null })

  const filtered = isFiltered(state)
  const noContacts = overview?.strip.total === 0
  const advanced: AdvancedFilters = { form: state.form, country: state.country, has: state.has, from: state.from, to: state.to, min: state.min, max: state.max }

  return (
    <div className="@container grid min-w-0 gap-8 pt-2 *:min-w-0">
      <PageHeader
        title="Contacts"
        description="Everyone who answered your forms, in one place."
        actions={
          data && !noContacts ? (
            <Button asChild variant="secondary">
              <a href={contactsCsvUrl(state)} download>
                <Download aria-hidden />
                Export CSV
              </a>
            </Button>
          ) : (
            <Button variant="secondary" disabled>
              <Download aria-hidden />
              Export CSV
            </Button>
          )
        }
      />

      {list.isError && !data ? (
        <section role="alert" className="grid justify-items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
          <h2 className="text-subheading">Contacts didn’t load</h2>
          <p className="text-body text-muted-foreground">{errorMessage(list.error)}</p>
          <Button variant="outline" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </section>
      ) : noContacts ? (
        <EmptyState
          icon={Contact}
          title="No contacts yet"
          actions={
            <Button asChild>
              <Link to="/dashboard">Go to forms</Link>
            </Button>
          }
        >
          Contacts appear here when a form with an Email or Phone field gets responses. Each person shows up once, with everything they sent.
        </EmptyState>
      ) : (
        <>
          <Strip
            strip={overview?.strip}
            activeForms={state.form}
            onForm={(id) => setFilters({ form: state.form.length === 1 && state.form[0] === id ? null : [id] })}
          />

          <div className="grid min-w-0 gap-6 *:min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox value={q} onChange={setQ} />
              <SegmentPills value={state.segment} strip={overview?.strip} onChange={(s) => update({ segment: s === 'all' ? null : s, page: null })} />
              <div className="flex flex-wrap items-center gap-2 @5xl:ml-auto">
                <FiltersButton value={advanced} facets={overview?.facets} onApply={applyFilters} />
                <SortControls sort={state.sort} dir={state.dir} onSort={sortBy} onDir={setDir} />
                {!narrow && view === 'table' && <ColumnsMenu hidden={hidden} onChange={setHidden} />}
                {!narrow && <ViewToggle view={view} onChange={setView} />}
              </div>
            </div>

            <ActiveFilters value={advanced} facets={overview?.facets} onChange={setFilters} />

            {!data ? (
              <CollectionSkeleton view={view} />
            ) : data.contacts.length === 0 ? (
              <section className="grid animate-fade-up justify-items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
                <SearchX className="size-8 text-muted-foreground" aria-hidden />
                <h2 className="text-subheading">No contacts match</h2>
                <p className="text-body text-muted-foreground">{filtered ? 'Try another search, or clear the filters.' : 'Nothing on this page. Go back a page.'}</p>
                {filtered ? (
                  <Button variant="outline" onClick={() => update(CLEAR_FILTERS)}>
                    Clear filters
                  </Button>
                ) : (
                  state.page > 1 && (
                    <Button variant="outline" onClick={() => update({ page: null })}>
                      Go to the first page
                    </Button>
                  )
                )}
              </section>
            ) : (
              <div aria-busy={list.isFetching} className={list.isPlaceholderData ? 'opacity-70 transition-opacity duration-(--duration-fast) ease-out' : undefined}>
                {view === 'table' ? (
                  <ContactsTable
                    contacts={data.contacts}
                    selected={selected}
                    onSelect={select}
                    onOpen={openContact}
                    onDelete={askDelete}
                    csvFor={csvFor}
                    activeKey={contactKey}
                    hidden={hidden}
                    sort={state.sort}
                    dir={state.dir}
                    onSort={sortBy}
                  />
                ) : (
                  <ContactsCards contacts={data.contacts} selected={selected} onSelect={select} onOpen={openContact} onDelete={askDelete} csvFor={csvFor} activeKey={contactKey} />
                )}
              </div>
            )}

            {data && data.total > 0 && (
              <Pagination page={data.page} pageSize={data.pageSize || CONTACTS_PAGE_SIZE} total={data.total} noun="contacts" onPage={(p) => update({ page: p > 1 ? p : null })} />
            )}

            {selected.size > 0 && (
              <BulkBar
                count={selected.size}
                csvHref={csvFor([...selected.keys()].slice(0, 1000))}
                onDelete={askDelete && (() => askDelete([...selected.values()]))}
                onClear={() => setSelected(new Map())}
              />
            )}
          </div>

          <p className="sr-only" role="status">
            {data ? `${plural(data.total, 'contact')} ${filtered ? 'found' : 'in total'}` : ''}
          </p>
        </>
      )}

      <ContactSheet
        contactKey={contactKey}
        onClose={closeContact}
        csvFor={csvFor}
        onDelete={canDelete ? (d) => setDeleting({ keys: [d.contact.key], responses: d.contact.responseCount, name: contactTitle(d.contact) }) : null}
      />

      <ConfirmDeleteContacts
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        contacts={deleting?.keys.length ?? 0}
        responses={deleting?.responses ?? 0}
        name={deleting?.name}
        pending={del.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
