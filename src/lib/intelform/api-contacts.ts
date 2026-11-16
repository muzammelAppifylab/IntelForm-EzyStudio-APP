import * as z from 'zod'
import { isRealDay } from './api-responses'

/**
 * Contacts: people who answered any form, grouped by email (or phone when a response has no email).
 * The `contacts` table holds one row per contact, kept by triggers on responses.
 *   GET  /site-api/contacts                list page (search, advanced filters, sort, 50 per page, keyset `cursor`)
 *   GET  /site-api/contacts/overview       the strip and filter choices (cached, workspace-wide)
 *   GET  /site-api/contacts/detail?key=    one contact and their latest responses, newest first
 *   POST /site-api/exports {kind: 'contacts', query}   the CSV, built by a background job (api-exports.ts)
 *   POST /site-api/contacts/delete         erase contacts: deletes every response they sent
 * Reading needs site:contact:read; erasing site:contact:write AND site:response:delete.
 */

export const CONTACTS_PAGE_SIZE = 50

/** A contact's key: "e:<lowercase email>" or "p:<E.164 phone>". */
export const contactKey = z.string().regex(/^(e:[^\s]{3,254}|p:\+[0-9]{6,16})$/, 'Unknown contact')

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealDay, 'Pick a real date')

export const CONTACT_SORTS = ['last_seen', 'first_seen', 'name', 'email', 'responses'] as const
export type ContactSort = (typeof CONTACT_SORTS)[number]
export const CONTACT_SORT_LABEL: Record<ContactSort, string> = {
  last_seen: 'Last active',
  first_seen: 'First seen',
  name: 'Name',
  email: 'Email',
  responses: 'Most responses',
}

/** new: first response inside the date range (or the last 7 days); returning: 2+ responses. */
export const CONTACT_SEGMENTS = ['all', 'new', 'returning'] as const
export type ContactSegment = (typeof CONTACT_SEGMENTS)[number]
export const CONTACT_SEGMENT_LABEL: Record<ContactSegment, string> = {
  all: 'All',
  new: 'New this week',
  returning: 'Returning',
}

/** Which contact details must be present. */
export const CONTACT_HAS = ['email', 'phone', 'name'] as const
export type ContactHas = (typeof CONTACT_HAS)[number]

/**
 * Filters shared by the list and the CSV export.
 * Query string: ?q=&segment=&form=<uuid>&form=…&country=XX&country=…&has=phone&has=…
 *               &from=&to=&tz=&min=&max=&sort=&dir=&page=
 * `form`, `country` and `has` repeat. Forms and countries are OR within the list; `has` is AND.
 */
export const contactsFilterQuery = z
  .object({
    /** Name, email or phone, substring match. */
    q: z.string().trim().max(200).optional(),
    segment: z.enum(CONTACT_SEGMENTS).default('all'),
    /** Contacts who answered any of these forms. */
    form: z.array(z.uuid()).max(50).default([]),
    /** ISO 3166 alpha-2, from the latest response's country. */
    country: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50).default([]),
    has: z.array(z.enum(CONTACT_HAS)).max(3).default([]),
    /** Last active between these local dates in `tz`, inclusive. */
    from: isoDay.optional(),
    to: isoDay.optional(),
    tz: z.string().max(64).optional(),
    /** Response count bounds, inclusive. */
    min: z.coerce.number().int().min(1).max(100_000).optional(),
    max: z.coerce.number().int().min(1).max(100_000).optional(),
    sort: z.enum(CONTACT_SORTS).default('last_seen'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'Start date must be before the end date', path: ['from'] })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, { message: 'Minimum must be at most the maximum', path: ['min'] })
export type ContactsFilterQuery = z.infer<typeof contactsFilterQuery>

export const contactsListQuery = contactsFilterQuery.and(
  /** The previous page's `nextCursor` (keyset: the last row's sort value and key). */
  z.object({ cursor: z.string().max(800).optional() }),
)
export type ContactsListQuery = z.infer<typeof contactsListQuery>

/** CSV export: the filters, or just the selected contacts. */
export const contactsCsvQuery = contactsFilterQuery.and(z.object({ key: z.array(contactKey).max(1000).default([]) }))
export type ContactsCsvQuery = z.infer<typeof contactsCsvQuery>

export const contactDetailQuery = z.object({ key: contactKey })

export const deleteContactsInput = z.object({
  keys: z.array(contactKey).min(1, 'Select at least one contact').max(500, 'Delete at most 500 contacts at a time'),
})
export type DeleteContactsInput = z.infer<typeof deleteContactsInput>

// ---------------------------------------------------------------------------------------
// Response shapes

export interface ContactFormRef {
  id: string
  title: string
  status: 'draft' | 'live' | 'closed'
}

export interface ContactRow {
  key: string
  email: string | null
  /** Latest non-empty name; split names are joined "First Last". */
  name: string | null
  phone: string | null
  /** ISO code from the latest response, if known. */
  country: string | null
  responseCount: number
  /** Distinct forms answered, most recent first, at most 3 (formCount has the full number). */
  forms: ContactFormRef[]
  formCount: number
  firstSeen: string
  lastSeen: string
}

export interface ContactsStrip {
  total: number
  /** First response in the last 7 days. */
  newThisWeek: number
  /** 2 or more responses. */
  returning: number
  /** Share of contacts with a phone number, 0–100. */
  withPhonePct: number
  /** Most contacts, top 3. */
  topForms: (ContactFormRef & { contacts: number })[]
}

export interface ContactsListResponse {
  contacts: ContactRow[]
  pageSize: number
  /** Pass as `cursor` for the next page; null on the last one. No total: there is no count per request. */
  nextCursor: string | null
}

/** GET /api/contacts/overview: whole workspace, ignoring filters, so it isn't refetched per page. */
export interface ContactsOverviewResponse {
  strip: ContactsStrip
  /** Filter choices: every form that collected a contact, and every country seen. */
  facets: {
    forms: (ContactFormRef & { contacts: number })[]
    countries: { code: string; contacts: number }[]
  }
}

export interface ContactResponseItem {
  id: string
  form: ContactFormRef
  submittedAt: string
  durationMs: number | null
  device: string | null
  country: string | null
}

export interface ContactDetailResponse {
  contact: ContactRow
  /** Every response, newest first, at most 200. */
  responses: ContactResponseItem[]
  /** Every distinct form answered. */
  forms: (ContactFormRef & { responses: number })[]
}

export interface DeleteContactsResponse {
  contacts: number
  responses: number
}
