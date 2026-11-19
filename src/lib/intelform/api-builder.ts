import { z } from 'zod'
import { formTheme, type FormTheme } from './form/theme'

/**
 * Builder-only API (Agent F): saved themes, presence, webhook tools, capabilities.
 *
 * Saved themes live at /api/themes. The other builder routes (server/routes/builder/) are
 * mounted at BUILDER_API in server/app.ts.
 */
export const BUILDER_API = '/site-api/builder'

// ---------------------------------------------------------------------------
// Saved themes
// ---------------------------------------------------------------------------

export const saveThemeInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Keep the name under 80 characters'),
  settings: formTheme,
})
export type SaveThemeInput = z.infer<typeof saveThemeInput>

export interface SavedTheme {
  id: string
  name: string
  settings: FormTheme
  /** The name of whoever saved it, or null when that account is gone. */
  createdBy: string | null
  createdAt: string
}

export interface SavedThemesResponse {
  themes: SavedTheme[]
}

// ---------------------------------------------------------------------------
// Presence: who else has this form open in the builder
// ---------------------------------------------------------------------------

export const presenceInput = z.object({
  /** One id per browser tab, so the same person in two tabs is noticed too. */
  tabId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
})

export interface PresenceEditor {
  /** `users.id`. */
  userId: number
  name: string
  /** True when it is the caller in another tab. */
  self: boolean
}

export interface PresenceResponse {
  /** Everyone else seen in the last 45 seconds, newest first. */
  others: PresenceEditor[]
  /** The form's current revision and last editor, so the client can spot a newer save. */
  revision: number
  updatedBy: { id: number; name: string } | null
}

// ---------------------------------------------------------------------------
// Webhook tools (the settings themselves go through PATCH /api/forms/:id)
// ---------------------------------------------------------------------------

export interface WebhookInfo {
  hasSecret: boolean
}

/** Returned once, right after the secret is generated or regenerated. */
export interface WebhookSecretResponse {
  secret: string
}

export interface WebhookDelivery {
  id: string
  createdAt: string
  url: string
  statusCode: number | null
  durationMs: number | null
  /** First 1 KB of the endpoint's answer. */
  responseBody: string | null
  error: string | null
  isTest: boolean
  responseId: string | null
  ok: boolean
  /** Queued as a background job, not sent yet. */
  pending?: boolean
}

export interface WebhookDeliveriesResponse {
  deliveries: WebhookDelivery[]
}

export interface WebhookSendResult {
  ok: boolean
  statusCode: number | null
  durationMs: number
  error: string | null
  deliveryId: string
  /** True on the live site while the background job has not run yet (poll the delivery). */
  queued?: boolean
}

// ---------------------------------------------------------------------------
// What the instance supports, for notes next to dependent settings
// ---------------------------------------------------------------------------

export interface BuilderCapabilities {
  emailEnabled: boolean
}
