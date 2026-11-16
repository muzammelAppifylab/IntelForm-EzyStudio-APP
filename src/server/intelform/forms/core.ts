import {z} from 'zod';

import {FORM_SORTS, FORM_STATUSES, type FormSort, type FormStatus} from '../../../lib/intelform/api-forms';
import {blankDefinition, formDefinition, type FormDefinition} from '../../../lib/intelform/form/definition';
import {defaultFormSettings, formSettings, type FormSettings, type FormSettingsPatch} from '../../../lib/intelform/form/settings';
import {defaultTheme, formTheme, type FormTheme} from '../../../lib/intelform/form/theme';
import {coreRegistry} from '../../../lib/intelform/form/types/registry';

/**
 * The forms API's pure logic (no database, no request): slugs, drafts, settings, the If-Match
 * revision, the list's keyset cursor, the webhook URL rule. Ported from IntelForm's
 * server/routes/forms.ts; the routes are src/server/routes/forms.ts.
 */

export const GONE = 'That form no longer exists';

/** An answer the route sends as is: `{error: code, message, fields?}` with `status`. */
export class FormsError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 412 | 422 | 500;
  readonly code: string;
  readonly fields?: Record<string, string[]>;
  readonly extra?: Record<string, unknown>;

  constructor(
    status: FormsError['status'],
    code: string,
    message: string,
    fields?: Record<string, string[]>,
    extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'FormsError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      ...(this.fields ? {fields: this.fields} : {}),
      ...(this.extra ?? {}),
    };
  }
}

export const notFound = (message = GONE) => new FormsError(404, 'not_found', message);

// ---------------------------------------------------------------------------
// Ids and slugs
// ---------------------------------------------------------------------------

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `length` characters from [a-z0-9], unbiased (rejection sampling over crypto bytes). */
export function randomSlug(length = 8): string {
  let out = '';
  const limit = 256 - (256 % SLUG_ALPHABET.length);
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b >= limit) continue;
      out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** A saved template's slug: `saved-` and 12 random characters. */
export const savedTemplateSlug = () => `saved-${randomSlug(12)}`;

/** Postgres unique violation, from Prisma's query API or a raw query, on any driver. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {code?: unknown; meta?: {code?: unknown}; originalCode?: unknown; cause?: unknown};
  if (e.code === 'P2002' || e.code === '23505' || e.originalCode === '23505' || e.meta?.code === '23505') return true;
  return e.cause !== undefined && e.cause !== err ? isUniqueViolation(e.cause) : false;
}

export const slugTakenError = () =>
  new FormsError(422, 'validation_failed', 'That link is taken', {slug: ['That link is already used by another form. Try another.']});

// ---------------------------------------------------------------------------
// Drafts, themes, settings
// ---------------------------------------------------------------------------

/** zod issues as `{'prefix.path': [messages]}` (at most 20). */
export function zodFields(error: z.ZodError, prefix?: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues.slice(0, 20)) {
    const key = [...(prefix ? [prefix] : []), ...issue.path.map(String)].join('.') || prefix || 'body';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

function repairDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const draft: Record<string, unknown> = {...(blankDefinition() as unknown as Record<string, unknown>), ...(raw as Record<string, unknown>)};
  if (Array.isArray(draft.fields)) {
    draft.fields = draft.fields.map((f: unknown) => {
      if (!f || typeof f !== 'object') return f;
      const field = f as Record<string, unknown>;
      const core = (coreRegistry as Record<string, {defaultProps: () => unknown} | undefined>)[String(field.type)];
      if (!core) return field;
      const props = field.props && typeof field.props === 'object' ? field.props : {};
      return {required: false, label: '', ...field, props: {...(core.defaultProps() as object), ...props}};
    });
  }
  return draft;
}

/**
 * Autosave accepts drafts mid-edit: a field missing some of its type's props gets that type's
 * defaults instead of being refused. Anything still invalid is a 422.
 */
export function normalizeDraft(raw: unknown): FormDefinition {
  const first = formDefinition.safeParse(raw);
  if (first.success) return first.data;
  const second = formDefinition.safeParse(repairDraft(raw));
  if (second.success) return second.data;
  throw new FormsError(422, 'validation_failed', 'The form couldn’t be saved: some fields are invalid', zodFields(second.error, 'draft'));
}

/** A stored draft, repaired if it can be, else a blank one (reads never fail on an old row). */
export function repairOrBlank(raw: unknown): FormDefinition {
  try {
    return normalizeDraft(raw);
  } catch {
    return blankDefinition();
  }
}

export function parseTheme(raw: unknown): FormTheme {
  const result = formTheme.safeParse(raw);
  if (result.success) return result.data;
  throw new FormsError(422, 'validation_failed', 'The design couldn’t be saved: check the theme settings', zodFields(result.error, 'theme'));
}

/** Stored settings, tolerant of old or partial rows. */
export function readSettings(raw: unknown): FormSettings {
  const result = formSettings.safeParse(raw);
  return result.success ? result.data : defaultFormSettings();
}

export function readTheme(raw: unknown): FormTheme {
  const result = formTheme.safeParse(raw);
  return result.success ? result.data : defaultTheme();
}

/** True when a stored theme object has any keys (an empty `{}` means "use the default"). */
export const hasTheme = (raw: unknown) => !!raw && typeof raw === 'object' && Object.keys(raw as object).length > 0;

export function countFields(def: FormDefinition): {fields: number; logicRules: number} {
  return {
    fields: def.fields.filter(f => f.type !== 'section_break').length,
    logicRules: def.fields.filter(f => !!f.logic).length,
  };
}

/** `If-Match: "12"`, `W/"12"` or `12`. Anything else means no revision check. */
export function ifMatchRevision(header: string | undefined | null): number | null {
  const m = header?.trim().match(/^(?:W\/)?"?(\d{1,9})"?$/);
  return m ? Number(m[1]) : null;
}

/**
 * The settings after a dashboard patch: only the keys sent change, the webhook merges key by
 * key, `password` was already hashed (`passwordHash`, or null to clear). Invalid → 422.
 */
export function mergeSettings(
  current: FormSettings,
  patch: Omit<FormSettingsPatch, 'password'>,
  password: {set: false} | {set: true; hash: string | null}
): FormSettings {
  const merged: Record<string, unknown> = {...current, ...patch};
  if (patch.webhook) merged.webhook = {...current.webhook, ...patch.webhook};
  if (password.set) merged.passwordHash = password.hash;
  const parsed = formSettings.safeParse(merged);
  if (!parsed.success) {
    throw new FormsError(422, 'validation_failed', 'Check the highlighted settings', zodFields(parsed.error, 'settings'));
  }
  return parsed.data;
}

/** "Close form now" and the status move together. */
export function statusAfterSettings(
  row: {status: FormStatus; publishedVersionId: string | null},
  before: FormSettings,
  after: FormSettings
): FormStatus {
  if (after.closed && row.status === 'live') return 'closed';
  if (!after.closed && before.closed && row.status === 'closed' && row.publishedVersionId) return 'live';
  return row.status;
}

/** Responses ÷ starts (0–1), or null before anyone started the form. */
export const completionRate = (responses: number, starts: number): number | null =>
  starts > 0 ? Math.min(1, responses / starts) : null;

// ---------------------------------------------------------------------------
// Webhook URL (SSRF: refused when saving, not only when sending)
// ---------------------------------------------------------------------------

export const HTTPS_REQUIRED = 'Use an https:// address. Webhooks carry answers, so plain http:// isn’t allowed.';

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(host: string): boolean {
  if (!host.includes(':')) return false;
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  // IPv4-mapped / -compatible (::ffff:10.0.0.1, ::ffff:a00:1): refused outright.
  if (h.startsWith('::ffff:') || /^::\d/.test(h) || h.startsWith('0:0:0:0:0:ffff:')) return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h) || h.startsWith('64:ff9b:') || h.startsWith('2001:db8:');
}

/** The message why a webhook URL can't be used, or null when it can. */
export function webhookUrlProblem(raw: string): string | null {
  if (raw.length > 2048) return 'Use a shorter URL';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full URL starting with https://';
  }
  if (url.protocol === 'http:') return HTTPS_REQUIRED;
  if (url.protocol !== 'https:') return 'Use an https:// address';
  if (url.username || url.password) return 'Remove the user name and password from the URL; use a custom header instead';
  // "localhost." and "db.internal." are the same names as without the final dot.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return 'Enter a full URL starting with https://';
  // The WHATWG parser already turns 0x7f.1, 2130706433 and friends into dotted IPv4.
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return 'Webhooks can’t be sent to private or local network addresses';
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host)) return 'Webhooks can’t be sent to local host names';
  return null;
}

// ---------------------------------------------------------------------------
// The forms list: query and keyset cursor
// ---------------------------------------------------------------------------

/** Forms per page: fills whole rows of the 2- and 3-column grid. */
export const PAGE_SIZE = 24;

/**
 * GET /site-api/forms. `cursor` is the previous page's `nextCursor` (keyset: no offset). `page`
 * is accepted for old links and ignored: the page number travels inside the cursor.
 */
export const listQuery = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: z.enum([...FORM_STATUSES, 'all']).default('all').catch('all'),
  sort: z.enum(FORM_SORTS).default('updated').catch('updated'),
  cursor: z.string().max(600).optional().catch(undefined),
});
export type ListQuery = z.infer<typeof listQuery>;

/** Where the next page starts: the last row's sort values plus its id. */
export type ListCursor =
  | {sort: 'updated'; page: number; at: Date; id: string}
  | {sort: 'created'; page: number; at: Date; id: string}
  | {sort: 'title'; page: number; title: string; id: string}
  | {sort: 'responses'; page: number; count: number; at: Date; id: string};

export interface CursorRow {
  id: string;
  title: string;
  responseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
};

/** The cursor after `row` (the last form on page `page`) in `sort` order. */
export function encodeCursor(sort: FormSort, page: number, row: CursorRow): string {
  const keys: unknown[] =
    sort === 'title'
      ? [row.title.toLowerCase()]
      : sort === 'responses'
        ? [row.responseCount, row.updatedAt.toISOString()]
        : [(sort === 'created' ? row.createdAt : row.updatedAt).toISOString()];
  return toB64(JSON.stringify([sort, page, ...keys, row.id]));
}

const isoDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * A cursor from the query string, or null when there is none or it doesn't fit (malformed, or
 * made for another sort order): the list then starts from the top.
 */
export function decodeCursor(raw: string | undefined, sort: FormSort): ListCursor | null {
  if (!raw) return null;
  let parts: unknown;
  try {
    parts = JSON.parse(fromB64(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts[0] !== sort) return null;
  const page = parts[1];
  const id = parts.at(-1);
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 100_000 || !isUuid(id)) return null;
  const p = page as number;
  switch (sort) {
    case 'title':
      return parts.length === 4 && typeof parts[2] === 'string' && parts[2].length <= 200 ? {sort, page: p, title: parts[2], id} : null;
    case 'responses': {
      const at = isoDate(parts[3]);
      return parts.length === 5 && Number.isSafeInteger(parts[2]) && (parts[2] as number) >= 0 && at
        ? {sort, page: p, count: parts[2] as number, at, id}
        : null;
    }
    default: {
      const at = isoDate(parts[2]);
      return parts.length === 4 && at ? {sort, page: p, at, id} : null;
    }
  }
}

/** `%` and `_` (and the escape itself) match literally in an ILIKE pattern. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
