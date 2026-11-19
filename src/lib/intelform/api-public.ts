import * as z from 'zod'
import type { FormDefinition } from './form/definition'
import type { PublicFormSettings } from './form/settings'
import type { FormTheme } from './form/theme'

/**
 * Respondent API: /api/public/forms/:slug (definition, unlock, events, submit). Owned by Agent E.
 * The browser imports the types and the small request schemas below; it never imports
 * shared/form/settings.ts at runtime (that file uses the non tree-shakable `{ z }` import).
 */

// ---------------------------------------------------------------------------
// GET /api/public/forms/:slug
// ---------------------------------------------------------------------------

interface PublicFormBase {
  id: string
  slug: string
  title: string
  /** Published theme (the closed and password screens are themed too). */
  theme: FormTheme
  settings: PublicFormSettings
}

/** A live form, ready to render and submit. */
export interface PublicFormLive extends PublicFormBase {
  status: 'live'
  versionId: string
  version: number
  definition: FormDefinition
  /** Signed render timestamp, sent back on submit (minimum fill time). */
  renderToken: string
}

/** Closed manually, past its close date, or at its response cap. */
export interface PublicFormClosed extends PublicFormBase {
  status: 'closed'
  message: string
}

/** Password protected and not unlocked yet: metadata only, no definition. */
export interface PublicFormLocked extends PublicFormBase {
  status: 'locked'
}

/** An old slug: the form moved. The browser replaces the URL and loads the new slug. */
export interface PublicFormMoved {
  status: 'moved'
  redirectTo: string
}

export type PublicFormResponse = PublicFormLive | PublicFormClosed | PublicFormLocked | PublicFormMoved

/** Header carrying the unlock token on GET and submit (never a cookie: iframes partition them). */
export const UNLOCK_HEADER = 'x-intelform-unlock'

// ---------------------------------------------------------------------------
// POST /api/public/forms/:slug/unlock
// ---------------------------------------------------------------------------

export const unlockInput = z.object({ password: z.string().min(1).max(200) })
export type UnlockInput = z.infer<typeof unlockInput>

export interface UnlockResponse {
  /** Short-lived HMAC token; keep it in memory and send it as UNLOCK_HEADER / `unlockToken`. */
  token: string
  form: PublicFormLive | PublicFormClosed
}

// ---------------------------------------------------------------------------
// POST /api/public/forms/:slug/events
// ---------------------------------------------------------------------------

export const FORM_EVENT_TYPES = ['view', 'start'] as const
export type FormEventType = (typeof FORM_EVENT_TYPES)[number]

export const formEventInput = z.object({
  type: z.enum(FORM_EVENT_TYPES),
  /** One uuid per form per browser session (sessionStorage). */
  session: z.uuid(),
})
export type FormEventInput = z.infer<typeof formEventInput>

// ---------------------------------------------------------------------------
// POST /api/public/forms/:slug/responses
// ---------------------------------------------------------------------------

export const submitInput = z.object({
  /** The version the browser rendered; answers are validated against it. */
  formVersionId: z.uuid(),
  answers: z.record(z.string(), z.unknown()),
  /** Epoch ms when the respondent started (Start, or the first answer). */
  startedAt: z.number().int().nonnegative().optional(),
  /** Time per field in ms, measured in the browser. */
  ttc: z.record(z.string(), z.number()).optional(),
  renderToken: z.string().max(200),
  /** Honeypot: must be empty. */
  hp: z.string().max(2000).optional(),
  unlockToken: z.string().max(400).optional(),
  /** One-response-per-browser token (cookie + localStorage); the server stores only its hash. */
  browserToken: z.string().max(100).optional(),
  /**
   * One random id per fill, kept across retries of that fill: a retry whose first try was saved
   * answers success again instead of saving a second response.
   */
  submissionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
})
export type SubmitInput = z.infer<typeof submitInput>

export interface SubmitResponse {
  ok: true
  /** Present when the form redirects after submit (answers appended when that setting is on). */
  redirectUrl?: string
}

/** Error codes the respondent UI handles specially (body: ApiErrorBody). */
export type SubmitErrorCode =
  | 'validation_failed' // 422, fields keyed by field id
  | 'form_closed' // 403
  | 'locked' // 401, password token missing or expired
  | 'already_responded' // 409 (one per browser)
  | 'version_unknown' // 409, reload the form
  | 'rate_limited' // 429
