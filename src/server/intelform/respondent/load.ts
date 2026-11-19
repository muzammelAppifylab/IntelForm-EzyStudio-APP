import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import type {PublicFormClosed, PublicFormLive, PublicFormLocked, PublicFormResponse} from '../../../lib/intelform/api-public';
import {formDefinition, type FormDefinition} from '../../../lib/intelform/form/definition';
import {SYSTEM_LABELS} from '../../../lib/intelform/form/labels';
import {defaultFormSettings, formSettings, publicSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import {defaultTheme, formTheme, type FormTheme} from '../../../lib/intelform/form/theme';
import {exactResponsesSql} from '../forms/counts';
import {notFound} from './errors';
import {checkUnlockToken, renderToken} from './tokens';
import {loadPublishedBySlug, type PublishedForm} from './cache';

/** A form as the respondent routes see it: the published version, parsed settings and status. */
export interface LoadedForm {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'live' | 'closed';
  responseCount: number;
  settings: FormSettings;
  versionId: string;
  version: number;
  definition: FormDefinition;
  theme: FormTheme;
}

export type Db = Pick<PrismaClient, '$queryRaw' | 'intelformSettings'>;

interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'live' | 'closed';
  response_count: number;
  settings: unknown;
  published_version_id: string | null;
  version: number | null;
  definition: unknown;
  theme: unknown;
}

export type LoadResult = {kind: 'form'; form: LoadedForm} | {kind: 'moved'; slug: string} | {kind: 'missing'};

/** What a public slug may look like (forms.slug is VarChar(60)); anything else is a plain 404. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function parseTheme(raw: unknown): FormTheme {
  const r = formTheme.safeParse(raw && typeof raw === 'object' && Object.keys(raw).length ? raw : defaultTheme());
  return r.success ? r.data : defaultTheme();
}

/** Stored settings over the defaults (a key added later still has a value); bad JSON → defaults. */
export function parseSettings(raw: unknown): FormSettings {
  const merged = {...defaultFormSettings(), ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})};
  const r = formSettings.safeParse(merged);
  return r.success ? r.data : defaultFormSettings();
}

export function toLoaded(row: FormRow): LoadedForm | null {
  if (!row.published_version_id || row.version === null || row.status === 'draft') return null;
  const def = formDefinition.safeParse(row.definition);
  if (!def.success) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    responseCount: Number(row.response_count),
    settings: parseSettings(row.settings),
    versionId: row.published_version_id,
    version: Number(row.version),
    definition: def.data,
    theme: parseTheme(row.theme),
  };
}

/**
 * The response count isClosed compares against a response cap: exact (the sum of the form's
 * form_counts shards, at most 16 rows by primary key) on a form that has a cap, so a form at
 * its cap reads closed at once and one under it after a delete reads open at once. Without a cap
 * the count is never compared, so the minute-old copy on forms is enough (no extra read).
 */
const capCountSql = Prisma.sql`CASE WHEN jsonb_typeof(f.settings->'responseCap') = 'number'
  THEN ${exactResponsesSql(Prisma.sql`f.id`)} ELSE f.response_count END`;

/** Loads the published form for a public slug; old slugs answer with the current one. */
export async function loadBySlug(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<LoadResult> {
  const clean = slug.toLowerCase();
  if (!SLUG_RE.test(clean)) return {kind: 'missing'};
  // One round trip: the form by slug, or else the form an old slug points at.
  const rows = await db.$queryRaw<(FormRow & {moved: boolean})[]>`
    SELECT f.id::text AS id, f.slug, f.title, f.status, ${capCountSql} AS response_count, f.settings,
           f.published_version_id::text AS published_version_id, v.version, v.definition, v.theme, false AS moved
    FROM forms f LEFT JOIN form_versions v ON v.id = f.published_version_id
    WHERE f.slug = ${clean}
    UNION ALL
    SELECT f.id::text, f.slug, f.title, f.status, f.response_count, NULL, NULL, NULL, NULL, NULL, true
    FROM form_slugs_old o JOIN forms f ON f.id = o.form_id
    WHERE o.slug = ${clean} AND NOT EXISTS (SELECT 1 FROM forms x WHERE x.slug = ${clean})
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return {kind: 'missing'};
  if (row.moved) return row.status !== 'draft' ? {kind: 'moved', slug: row.slug} : {kind: 'missing'};
  const form = toLoaded(row);
  return form ? {kind: 'form', form} : {kind: 'missing'};
}

/** Loads a form or throws the 404 every draft, moved or unknown slug gets. */
export async function requireForm(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<LoadedForm> {
  const r = await loadBySlug(db, slug);
  if (r.kind !== 'form') throw notFound();
  return r.form;
}

/** Closed manually, past its close date, or at its response cap (checked at read time). */
export function isClosed(form: Pick<LoadedForm, 'status' | 'settings' | 'responseCount'>, now = Date.now()): boolean {
  if (form.status !== 'live') return true;
  const {closeAt, responseCap} = form.settings;
  if (closeAt && Date.parse(closeAt) <= now) return true;
  if (responseCap !== null && form.responseCount >= responseCap) return true;
  return false;
}

/**
 * The GET payload. Password-protected forms return metadata only unless `unlock` is a valid
 * token; closed forms return the closed message, never the definition.
 */
export async function publicPayload(
  db: Db,
  secret: string,
  form: LoadedForm,
  unlock?: string | null
): Promise<PublicFormLive | PublicFormClosed | PublicFormLocked> {
  const base = {
    id: form.id,
    slug: form.slug,
    title: form.title,
    theme: form.theme,
    settings: publicSettings(form.settings),
  };
  if (isClosed(form)) return {...base, status: 'closed', message: form.settings.closedMessage || SYSTEM_LABELS.closed};
  const hash = form.settings.passwordHash;
  if (hash && !(await checkUnlockToken(secret, unlock, form.id, hash))) return {...base, status: 'locked'};
  const token = await renderToken(secret, form.id);
  return {
    ...base,
    status: 'live',
    versionId: form.versionId,
    version: form.version,
    definition: form.definition,
    renderToken: token,
  };
}

/** What the cache leaves out of a form, read exactly: one row by primary key. */
export interface FormState {
  /** The exact all-time responses (form_counts). */
  responses: number;
  passwordHash: string | null;
}

export async function formState(db: Pick<PrismaClient, '$queryRaw'>, formId: string): Promise<FormState | null> {
  const rows = await db.$queryRaw<{responses: number; password_hash: string | null}[]>`
    SELECT ${exactResponsesSql(Prisma.sql`f.id`)} AS responses, f.settings->>'passwordHash' AS password_hash
    FROM forms f WHERE f.id = ${formId}::uuid
  `;
  const row = rows[0];
  return row ? {responses: Number(row.responses), passwordHash: row.password_hash || null} : null;
}

/** A published form needs its exact count read: it has a cap and came from the cache. */
export const needsCount = (p: PublishedForm) => !p.countExact && p.form.settings.responseCap !== null;

/** A password token must be checked and the hash wasn't read with the form. */
export const needsHash = (p: PublishedForm, unlock?: string | null) => p.hasPassword && p.passwordHash === undefined && !!unlock;


/**
 * Stands in for the hash of a form with a password when no unlock token was sent (the locked
 * screen): nothing is checked against it (checkUnlockToken refuses a missing token first), and
 * it never leaves the server (publicSettings only says `passwordRequired`).
 */
const HASH_NOT_READ = '!not-read';

/**
 * The GET payload of a published form (cached or not). Reads the database only for what the
 * cache leaves out and this answer needs, in ONE statement: the exact count of a capped form and
 * the password hash when a token must be checked (the locked screen never needs it). A caller
 * that already read them (`state`, e.g. with its rate-limit statement) costs no read here.
 */
export async function publishedPayload(
  db: Db,
  secret: string,
  p: PublishedForm,
  unlock?: string | null,
  state?: FormState | null
): Promise<PublicFormLive | PublicFormClosed | PublicFormLocked | null> {
  let known = state ?? null;
  if (!known && (needsCount(p) || needsHash(p, unlock))) {
    known = await formState(db, p.form.id);
    if (!known) return null;
  }
  const hash = known ? known.passwordHash : p.passwordHash;
  const passwordHash = hash === undefined ? (p.hasPassword ? HASH_NOT_READ : null) : hash;
  const responseCount = p.countExact ? p.form.responseCount : (known?.responses ?? 0);
  return publicPayload(db, secret, {...p.form, responseCount, settings: {...p.form.settings, passwordHash}}, unlock);
}

/**
 * Full GET answer for a slug, or null for a 404. Shared by the API route and the /f/[slug] page.
 * The published shape comes from the Site Cache when it can (./cache.ts); the render token,
 * "closed now", a capped form's count and a password check are worked out per request.
 */
export async function payloadForSlug(db: Db, secret: string, slug: string, unlock?: string | null): Promise<PublicFormResponse | null> {
  const r = await loadPublishedBySlug(db, slug);
  if (r.kind === 'missing') return null;
  if (r.kind === 'moved') return {status: 'moved', redirectTo: r.slug};
  return publishedPayload(db, secret, r.published, unlock);
}
