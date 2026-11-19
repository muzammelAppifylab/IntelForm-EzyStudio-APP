import {isSafeUrl} from '../../../../lib/intelform/form/safe-url';
import {webhookHeaderInput, type FormSettingsPatch} from '../../../../lib/intelform/form/settings';
import type {FieldMessages} from '../../lib/api';

/**
 * The Settings tab's pure rules (tested in tests/intelform/builder-settings.test.ts): where a
 * server error lands, which links count, the webhook header checks, the close-date default.
 */

export type SettingErrors = Record<string, string>;

/**
 * A 422 from PATCH /site-api/forms/:id names fields like `settings.redirectUrl` or
 * `settings.webhook.url`; each lands on its setting (`redirectUrl`, `webhook.url`). The bare
 * `settings` key is too vague to place: the caller toasts the message instead.
 */
export function settingsFieldErrors(fields: FieldMessages | undefined): SettingErrors {
  const out: SettingErrors = {};
  for (const [key, messages] of Object.entries(fields ?? {})) {
    const message = messages?.[0];
    const name = key.replace(/^settings\./, '');
    if (!message || name === 'settings') continue;
    out[name] = message;
  }
  return out;
}

/** Drops the errors of the settings a new patch touches (`webhook` clears `webhook.url` too). */
export function clearErrorsFor(errors: SettingErrors, patch: FormSettingsPatch): SettingErrors {
  const keys = new Set(Object.keys(patch));
  return Object.fromEntries(Object.entries(errors).filter(([k]) => !keys.has(k.split('.')[0]!)));
}

/** A redirect link: http(s) and safe (no javascript:, no credentials, no private hosts by name). */
export function isRedirectUrl(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\//i.test(v) && isSafeUrl(v);
}

/** A webhook endpoint: http(s) with a dotted host. The server also checks it isn't private. */
export function isWebhookUrl(value: string): boolean {
  const v = value.trim();
  if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

export interface WebhookHeader {
  key: string;
  value: string;
}

/** The message for one header row, or null (an empty row is fine: it is dropped on save). */
export function headerError(h: WebhookHeader): string | null {
  if (!h.key && !h.value) return null;
  const r = webhookHeaderInput.safeParse(h);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Check this header');
}

/** The headers to save, or null while any row is wrong (nothing is saved then). */
export function headersToSave(rows: WebhookHeader[]): WebhookHeader[] | null {
  const kept = rows.filter(h => h.key.trim());
  if (!kept.every(h => webhookHeaderInput.safeParse(h).success)) return null;
  return kept.map(h => ({key: h.key.trim(), value: h.value}));
}

/** What a viewer sees: the URL is a secret, so only on or off when it was blanked. */
export function webhookSummary(webhook: {enabled: boolean; url: string | null}, redacted: boolean): string {
  if (redacted) return webhook.enabled ? 'Webhook is on: each response is sent to a URL an editor set up.' : 'No webhook is set up.';
  return webhook.enabled && webhook.url ? `Responses are sent to ${webhook.url}.` : 'No webhook is set up.';
}

/** "Close on a date" starts a week ahead at 17:00 local time, as `YYYY-MM-DDTHH:mm`. */
export function defaultCloseLocal(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 7 * 864e5);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T17:00`;
}

/** Ticking a teammate on or off in "Who gets it". */
export function toggleRecipient(list: number[], id: number, on: boolean): number[] {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter(x => x !== id);
}
