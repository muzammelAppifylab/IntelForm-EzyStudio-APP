import type { InvitableRole, Role } from './roles'

/** Response shapes shared by the API and the browser. */

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    /** Per-field messages for 422 validation errors, keyed by input name. */
    fields?: Record<string, string[] | undefined>
    /** Request id (also in the X-Request-Id header) for reporting a server error. */
    requestId?: string
  }
}

export interface Me {
  id: string
  name: string
  email: string
  role: Role
  avatarUrl: string | null
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  avatarUrl: string | null
  createdAt: string
}

export interface PendingInvite {
  id: string
  email: string
  role: InvitableRole
  expiresAt: string
  createdAt: string
}

export interface TeamResponse {
  members: TeamMember[]
  /** Only the Owner receives pending invites. */
  invites: PendingInvite[]
}

export interface CreatedInvite {
  invite: PendingInvite
  /** Shareable link. The Owner copies it while no email provider is set up. */
  link: string
  emailed: boolean
}

export interface InviteInfo {
  email: string
  role: InvitableRole
  appName: string
}

export interface SetupStatus {
  needsSetup: boolean
}

export interface AppInfo {
  appName: string
  logoUrl: string | null
  /** False until an email provider is configured: hides "Forgot password". */
  emailEnabled: boolean
}

/** POST /api/uploads?purpose= */
export interface UploadResult {
  /** Public URL: the Bunny CDN, or /api/uploads/files/… with local storage. */
  url: string
  contentType: string
  size: number
}

/** GET /api/health (process is up) and GET /api/ready (database answers). */
export interface HealthResponse {
  ok: boolean
  /** Only on /api/ready. */
  database?: 'ok' | 'unavailable'
}

export type { AppSettingsView, SecretState, SettingsTestResult } from './settings-app'
