import { z } from 'zod'
import type { FormDefinition, Layout } from './form/definition'
import { formSettingsPatch, type ClientFormSettings } from './form/settings'
import type { FormTheme } from './form/theme'

/** Request schemas and response shapes for /api/forms and /api/templates (dashboard). */

export const FORM_STATUSES = ['draft', 'live', 'closed'] as const
export type FormStatus = (typeof FORM_STATUSES)[number]

export const FORM_STATUS_LABEL: Record<FormStatus, string> = { draft: 'Draft', live: 'Live', closed: 'Closed' }

export const FORM_SORTS = ['updated', 'created', 'title', 'responses'] as const
export type FormSort = (typeof FORM_SORTS)[number]

export const FORM_SORT_LABEL: Record<FormSort, string> = {
  updated: 'Last updated',
  created: 'Newest',
  title: 'Title',
  responses: 'Most responses',
}

export const FORMS_VIEWS = ['grid', 'list'] as const
export type FormsView = (typeof FORMS_VIEWS)[number]

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Forms per page on the Forms list: fills whole rows of the 2- and 3-column grid. */
export const FORMS_PAGE_SIZE = 24

/** GET /api/forms query string. */
export const formsListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum([...FORM_STATUSES, 'all']).default('all'),
  sort: z.enum(FORM_SORTS).default('updated'),
  /** Keyset paging: the previous page's `nextCursor` (GET /site-api/forms?cursor=…). */
  cursor: z.string().max(600).optional(),
})
export type FormsListQuery = z.infer<typeof formsListQuery>

export const formTitle = z.string().trim().min(1, 'Enter a title').max(200, 'Keep the title under 200 characters')

/** Public link slug: letters, digits and hyphens (PRD "Sharing and publishing"). */
export const formSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(60, 'Keep the link under 60 characters')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use letters, digits and hyphens, starting and ending with a letter or digit')

/** POST /api/forms: blank, or from a template by id or slug. */
export const createFormInput = z.object({
  title: formTitle.optional(),
  templateId: z.uuid().optional(),
  templateSlug: z.string().max(80).optional(),
})
export type CreateFormInput = z.infer<typeof createFormInput>

/**
 * PATCH /api/forms/:id (autosave). Send only what changed. `draft` and `theme` are checked by
 * the server against the form definition and theme schemas; send `If-Match: "<revision>"`.
 */
export const formPatchInput = z
  .object({
    title: formTitle.optional(),
    slug: formSlug.optional(),
    draft: z.record(z.string(), z.unknown()).optional(),
    theme: z.record(z.string(), z.unknown()).optional(),
    settings: formSettingsPatch.optional(),
  })
  .strict()
export type FormPatchInput = z.infer<typeof formPatchInput>

export const renameFormInput = z.object({ title: formTitle })

export const deleteFormInput = z.object({ confirmTitle: z.string().max(200) })

export const saveAsTemplateInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(300).optional(),
})
export type SaveAsTemplateInput = z.infer<typeof saveAsTemplateInput>

export const templatePatchInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  category: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(300).optional(),
})
export type TemplatePatchInput = z.infer<typeof templatePatchInput>

export const formsViewInput = z.object({ view: z.enum(FORMS_VIEWS) })

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface FormListItem {
  id: string
  title: string
  slug: string
  status: FormStatus
  layout: Layout
  responseCount: number
  /** Responses ÷ starts (0–1), or null before anyone starts the form. */
  completionRate: number | null
  /** Published at least once and the draft or theme changed since. */
  hasUnpublished: boolean
  /** Responses in the last 7 days. */
  newThisWeek: number
  createdAt: string
  updatedAt: string
}

/** GET /api/forms/strip. */
export interface FormsStrip {
  /** Responses across all forms in the last 7 days. */
  responsesThisWeek: number
  /** The 7 days before that, for the trend. */
  responsesLastWeek: number
  /** Up to 3 forms with the most responses in the last 7 days. */
  mostActive: { id: string; title: string; count: number; status: FormStatus; completionRate: number | null }[]
  /** Responses per calendar day in the app's timezone: 7 entries, oldest first, the last is today. */
  days: { date: string; count: number }[]
  /** Forms per status, ignoring search and filter. */
  counts: Record<'all' | FormStatus, number>
  /** Mean completion rate of the forms anyone has started, or null when none has been. */
  avgCompletion: number | null
}

export interface FormsListResponse {
  /** One page of the forms matching the search and filter. */
  forms: FormListItem[]
  /** Forms that exist at all, ignoring search and filter (tells "no results" from "no forms"). */
  total: number
  /** Forms matching the search and filter, across every page. */
  matched: number
  page: number
  pageSize: number
  /** Pass as `?cursor=` for the next page; null on the last one. */
  nextCursor: string | null
}

export interface CreatedForm {
  id: string
  slug: string
  title: string
}

export interface FormDetail {
  id: string
  title: string
  slug: string
  status: FormStatus
  draft: FormDefinition
  theme: FormTheme
  settings: ClientFormSettings
  revision: number
  /** The live version number, or null before the first Publish. */
  publishedVersion: number | null
  publishedAt: string | null
  hasUnpublished: boolean
  createdAt: string
  updatedAt: string
  updatedBy: { id: number; name: string } | null
  counts: { fields: number; logicRules: number; responses: number }
}

export interface FormPatchResponse {
  revision: number
  /** True when someone saved since the If-Match revision; this save replaced theirs. */
  overwrote: boolean
  overwrittenBy: { id: number; name: string } | null
  hasUnpublished: boolean
  slug: string
  status: FormStatus
  settings?: ClientFormSettings
}

export interface PublishResponse {
  version: number
  publishedAt: string
  status: FormStatus
  /** The form's revision after publishing, so the next autosave isn't seen as a conflict. */
  revision: number
  responses: number
}

export interface LogicIssueBody {
  /** 422 code 'logic_issues': the list returned by lintLogic. */
  issues: unknown[]
}

/** POST /api/forms/:id/close and /reopen: everything the builder refreshes afterwards. */
export interface FormStatusResponse {
  status: FormStatus
  revision: number
  hasUnpublished: boolean
  responses: number
  settings: ClientFormSettings
}

export interface TemplateSummary {
  id: string
  slug: string
  name: string
  category: string
  description: string
  isBuiltin: boolean
  layout: Layout
  fieldCount: number
  /** The name of whoever saved it, or null when that account is gone. */
  createdBy: string | null
  createdAt: string
}

export interface TemplatesResponse {
  templates: TemplateSummary[]
  /** Categories in display order (built-in order first, then saved ones). */
  categories: string[]
}

export interface FormsViewResponse {
  view: FormsView
}
