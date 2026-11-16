import type {z} from 'zod';

import type {AppSettingsView, SettingsTestResult} from '../../../lib/intelform/settings-app';

/**
 * Browser-safe pieces of the App settings API (no server imports): the portal imports the
 * response type and the pure helpers from here.
 *
 *   GET   /site-api/app-settings             → AppSettingsResponse
 *   PATCH /site-api/app-settings  {group: …} → AppSettingsResponse (422 {fields} on bad input)
 *   POST  /site-api/app-settings/spam/test   → SettingsTestResult
 */

export const APP_SETTINGS_API = '/site-api/app-settings';

/** The settings view, with both Turnstile keys reported as present or not (owner secrets). */
export interface AppSettingsResponse extends Omit<AppSettingsView, 'spam'> {
  spam: {
    /** Always null: the site key is an owner secret now (see `siteKeySet`). */
    turnstileSiteKey: null;
    /** `TURNSTILE_SITE_KEY` is present (or a key saved before the move). */
    turnstileSiteKeySet: boolean;
    /** `TURNSTILE_SECRET_KEY` is present. */
    turnstileSecretSet: boolean;
  };
}

export function toResponse(view: AppSettingsView, extra: {siteKeySet: boolean}): AppSettingsResponse {
  return {
    ...view,
    spam: {turnstileSiteKey: null, turnstileSiteKeySet: extra.siteKeySet, turnstileSecretSet: view.spam.turnstileSecretSet},
  };
}

/**
 * Zod issues → `{inputName: message}`, keyed by the LAST path segment ("general.appName" →
 * "appName"): each settings card sends one group, and its inputs are named by the leaf. The
 * first message per field wins; issues without a path become the form message.
 */
export function fieldErrorsOf(error: z.ZodError): {fields: Record<string, string>; form: string | null} {
  const fields: Record<string, string> = {};
  let form: string | null = null;
  for (const issue of error.issues) {
    const leaf = issue.path.length ? String(issue.path[issue.path.length - 1]) : '';
    if (!leaf) form ??= issue.message;
    else fields[leaf] ??= issue.message;
  }
  return {fields, form};
}

/**
 * What Cloudflare's siteverify answer to a dummy token says about the secret key. A dummy
 * token is always refused; what matters is WHY: "invalid-input-secret" means the key is wrong.
 */
export function turnstileTestResult(reply: {success?: boolean; 'error-codes'?: string[]} | null): SettingsTestResult {
  if (!reply) return {ok: false, message: 'Cloudflare gave an answer we couldn’t read. Try again in a minute.'};
  const codes = reply['error-codes'] ?? [];
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    return {ok: false, message: 'Cloudflare rejected the secret key. Copy it again from the Turnstile dashboard and update the TURNSTILE_SECRET_KEY owner secret.'};
  }
  return {ok: true, message: 'Cloudflare accepted the secret key.'};
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date in one of the app date formats, as an example in the picker. */
export function formatExample(format: string, d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  switch (format) {
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`;
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'D MMM YYYY':
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${yyyy}`;
    default:
      return format;
  }
}
