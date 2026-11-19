/**
 * Response shapes shared by the Site API's IntelForm routes and the browser.
 *
 * Accounts, sign-in, setup, invites, the team and sessions are the template's (src/platform/auth,
 * /dashboard/users, /dashboard/roles): IntelForm's own versions of them are gone. Who may do
 * what is src/server/permissions.ts (mirrored for the UI in ./roles.ts).
 */

/**
 * An error body: the template's `problem()` shape (src/platform/guards.ts), plus per-field
 * messages on a 422. Field keys are input names (dashboard forms) or field ids (respondent
 * answers, `validation_failed`).
 */
export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string | string[] | undefined>;
}

/** The first message for one field of an error body, if any. */
export function fieldError(body: ApiErrorBody | null | undefined, name: string): string | undefined {
  const v = body?.fields?.[name];
  return Array.isArray(v) ? v[0] : v;
}

/** A file stored through the platform's files (src/platform/files.ts) and shown back. */
export interface UploadResult {
  /** URL the dashboard and the respondent page show. */
  url: string;
  contentType: string;
  size: number;
}

export type {AppSettingsView} from './settings-app';
