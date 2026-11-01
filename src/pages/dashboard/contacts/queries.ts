import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import {
  CONTACT_HAS,
  CONTACT_SEGMENTS,
  CONTACT_SORTS,
  type ContactDetailResponse,
  type ContactHas,
  type ContactSegment,
  type ContactSort,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '@shared/api-contacts'
import { toQueryString } from '@shared/api-responses'
import { api, errorMessage } from '@/lib/api'
import { formsKey } from '../forms/queries'

/** Data and URL state for the Contacts page. Everything that defines a view lives in the URL. */

export const contactsKey = ['contacts'] as const

/** CSV download (filters, or selected keys). */
export const CONTACTS_CSV_PATH = '/api/contacts/export.csv'

export const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

export interface ContactsState {
  q: string
  segment: ContactSegment
  form: string[]
  country: string[]
  has: ContactHas[]
  from?: string
  to?: string
  min?: number
  max?: number
  sort: ContactSort
  dir: 'asc' | 'desc'
  page: number
}

/** The advanced filters (the ones in the Filters panel), apart from search and segment. */
export type AdvancedFilters = Pick<ContactsState, 'form' | 'country' | 'has' | 'from' | 'to' | 'min' | 'max'>

/** Name and email read A to Z by default; dates and counts newest / most first. */
export const defaultDir = (sort: ContactSort): 'asc' | 'desc' => (sort === 'name' || sort === 'email' ? 'asc' : 'desc')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

function count(v: string | null): number | undefined {
  if (!v) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : undefined
}

export type UrlPatch = Record<string, string | number | string[] | null | undefined>

export function useContactsUrl() {
  const [params, setParams] = useSearchParams()
  const state = useMemo<ContactsState>(() => {
    const segment = params.get('segment') as ContactSegment | null
    const sort = params.get('sort') as ContactSort | null
    const s: ContactSort = sort && CONTACT_SORTS.includes(sort) ? sort : 'last_seen'
    const dir = params.get('dir')
    const from = params.get('from') ?? undefined
    const to = params.get('to') ?? undefined
    return {
      q: params.get('q') ?? '',
      segment: segment && CONTACT_SEGMENTS.includes(segment) ? segment : 'all',
      form: params.getAll('form').filter((f) => UUID.test(f)).slice(0, 50),
      country: params.getAll('country').filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 50),
      has: CONTACT_HAS.filter((h) => params.getAll('has').includes(h)),
      from: from && DAY.test(from) ? from : undefined,
      to: to && DAY.test(to) ? to : undefined,
      min: count(params.get('min')),
      max: count(params.get('max')),
      sort: s,
      dir: dir === 'asc' || dir === 'desc' ? dir : defaultDir(s),
      page: Math.max(1, Math.min(100_000, Math.floor(Number(params.get('page'))) || 1)),
    }
  }, [params])
  const contactKey = params.get('contact')

  /** Patch the URL: null/undefined/'' removes a key, arrays become repeated keys. */
  const update = useCallback(
    (patch: UrlPatch, opts: { replace?: boolean } = {}) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            next.delete(k)
            if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
            else if (v !== null && v !== undefined && v !== '') next.set(k, String(v))
          }
          return next
        },
        { replace: opts.replace ?? false },
      ),
    [setParams],
  )

  return { state, contactKey, update }
}

/** Removes every filter (search, segment and the advanced ones); keeps sort. */
export const CLEAR_FILTERS: UrlPatch = { q: null, segment: null, form: null, country: null, has: null, from: null, to: null, min: null, max: null, page: null }

export function advancedCount(s: AdvancedFilters): number {
  return [s.form.length > 0, s.country.length > 0, s.has.length > 0, !!(s.from || s.to), s.min !== undefined || s.max !== undefined].filter(Boolean).length
}

export function isFiltered(s: ContactsState): boolean {
  return s.q !== '' || s.segment !== 'all' || advancedCount(s) > 0
}

function filterParams(s: ContactsState) {
  return {
    q: s.q || undefined,
    segment: s.segment === 'all' ? undefined : s.segment,
    form: s.form,
    country: s.country,
    has: s.has,
    from: s.from,
    to: s.to,
    tz: browserTz,
    min: s.min,
    max: s.max,
    sort: s.sort,
    dir: s.dir,
  }
}

export function contactsListQuery(s: ContactsState) {
  return queryOptions({
    queryKey: [...contactsKey, 'list', s],
    queryFn: () => api<ContactsListResponse>(`/api/contacts${toQueryString({ ...filterParams(s), page: s.page > 1 ? s.page : undefined })}`),
    placeholderData: keepPreviousData,
  })
}

/** Strip and filter choices: workspace-wide, so one fetch serves every page and filter. */
export const contactsOverviewQuery = queryOptions({
  queryKey: [...contactsKey, 'overview'],
  queryFn: () => api<ContactsOverviewResponse>('/api/contacts/overview'),
  staleTime: 60_000,
})

export function contactDetailQuery(key: string) {
  return queryOptions({
    queryKey: [...contactsKey, 'detail', key],
    queryFn: () => api<ContactDetailResponse>(`/api/contacts/detail${toQueryString({ key })}`),
  })
}

/** CSV of the current filters, or of just these contacts. */
export function contactsCsvUrl(s: ContactsState, keys: string[] = []) {
  const qs = keys.length ? toQueryString({ key: keys, tz: browserTz, sort: s.sort, dir: s.dir }) : toQueryString(filterParams(s))
  return `${CONTACTS_CSV_PATH}${qs}`
}

export function useDeleteContacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (keys: string[]) => api<DeleteContactsResponse>('/api/contacts/delete', { method: 'POST', body: { keys } }),
    onSuccess: ({ contacts }) => {
      toast.success(contacts === 1 ? 'Contact deleted' : `${contacts} contacts deleted`)
      void qc.invalidateQueries({ queryKey: contactsKey })
      void qc.invalidateQueries({ queryKey: formsKey })
      void qc.invalidateQueries({ queryKey: ['responses'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

/** Copies `text` and toasts the outcome; resolves true only when the clipboard write succeeded. */
export async function copyText(text: string, done: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
    return true
  } catch {
    toast.error('Couldn’t copy. Select the text and copy it instead.')
    return false
  }
}

// ---------------------------------------------------------------------------------------
// Per-viewer preferences (localStorage; the page works without it)

export type ContactsView = 'table' | 'cards'
export const COLUMNS = ['phone', 'country', 'forms', 'responses', 'firstSeen', 'lastSeen'] as const
export type ColumnId = (typeof COLUMNS)[number]
export const COLUMN_LABEL: Record<ColumnId, string> = {
  phone: 'Phone',
  country: 'Country',
  forms: 'Forms',
  responses: 'Responses',
  firstSeen: 'First seen',
  lastSeen: 'Last active',
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

const VIEW_KEY = 'intelform.contacts.view'
const COLUMNS_KEY = 'intelform.contacts.hiddenColumns'

export function useContactsView(): [ContactsView, (v: ContactsView) => void] {
  const [view, setView] = useState<ContactsView>(() => (readStorage(VIEW_KEY) === 'cards' ? 'cards' : 'table'))
  const change = useCallback((v: ContactsView) => {
    setView(v)
    writeStorage(VIEW_KEY, v)
  }, [])
  return [view, change]
}

export function useHiddenColumns(): [ColumnId[], (cols: ColumnId[]) => void] {
  const [hidden, setHidden] = useState<ColumnId[]>(() => {
    try {
      const parsed: unknown = JSON.parse(readStorage(COLUMNS_KEY) ?? '[]')
      return Array.isArray(parsed) ? COLUMNS.filter((c) => parsed.includes(c)) : []
    } catch {
      return []
    }
  })
  const change = useCallback((cols: ColumnId[]) => {
    setHidden(cols)
    writeStorage(COLUMNS_KEY, JSON.stringify(cols))
  }, [])
  return [hidden, change]
}
