import type {PrismaClient} from '../../../generated/prisma/client';
import {config} from '../../../platform/config';
import type {PublicFormClosed, PublicFormLive, PublicFormLocked, PublicFormResponse} from '../../../lib/intelform/api-public';
import {formDefinition, type FormDefinition} from '../../../lib/intelform/form/definition';
import {SYSTEM_LABELS} from '../../../lib/intelform/form/labels';
import {defaultFormSettings, formSettings, publicSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import {defaultTheme, formTheme, type FormTheme} from '../../../lib/intelform/form/theme';
import {notFound} from './errors';
import {checkUnlockToken, renderToken} from './tokens';

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

/** Loads the published form for a public slug; old slugs answer with the current one. */
export async function loadBySlug(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<LoadResult> {
  const clean = slug.toLowerCase();
  if (!SLUG_RE.test(clean)) return {kind: 'missing'};
  // One round trip: the form by slug, or else the form an old slug points at.
  const rows = await db.$queryRaw<(FormRow & {moved: boolean})[]>`
    SELECT f.id::text AS id, f.slug, f.title, f.status, f.response_count, f.settings,
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

export type FormMeta = Pick<LoadedForm, 'id' | 'status' | 'responseCount' | 'settings'>;

/**
 * Just what isClosed needs, for hot paths like the view/start beacons: no published definition
 * or theme to read and parse. Same 404s as requireForm (drafts, unknown and old slugs).
 */
export async function requireFormMeta(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<FormMeta> {
  const clean = slug.toLowerCase();
  const rows = SLUG_RE.test(clean)
    ? await db.$queryRaw<{id: string; status: LoadedForm['status']; response_count: number; settings: unknown}[]>`
        SELECT id::text AS id, status, response_count, settings FROM forms
        WHERE slug = ${clean} AND published_version_id IS NOT NULL AND status <> 'draft'
      `
    : [];
  const row = rows[0];
  if (!row) throw notFound();
  return {id: row.id, status: row.status, responseCount: Number(row.response_count), settings: parseSettings(row.settings)};
}

/** Closed manually, past its close date, or at its response cap (checked at read time). */
export function isClosed(form: Pick<LoadedForm, 'status' | 'settings' | 'responseCount'>, now = Date.now()): boolean {
  if (form.status !== 'live') return true;
  const {closeAt, responseCap} = form.settings;
  if (closeAt && Date.parse(closeAt) <= now) return true;
  if (responseCap !== null && form.responseCount >= responseCap) return true;
  return false;
}

/** The owner secret holding the Turnstile secret key (docs/agent/security.md "Calling other services"). */
export const TURNSTILE_SECRET_NAME = 'TURNSTILE_SECRET_KEY';

/**
 * Turnstile keys when this form uses it AND the owner configured both: the site key in
 * App settings (intelform_settings), the secret as the owner secret TURNSTILE_SECRET_KEY.
 * Either missing → null: Turnstile is skipped (honeypot, fill time and rate limits still apply).
 */
export async function turnstileFor(
  db: Pick<PrismaClient, 'intelformSettings'>,
  settings: Pick<FormSettings, 'turnstile'>
): Promise<{siteKey: string; secret: string} | null> {
  if (!settings.turnstile) return null;
  const secret = config.ownerSecret(TURNSTILE_SECRET_NAME);
  if (!secret) return null;
  const row = await db.intelformSettings.findUnique({where: {id: 1}, select: {turnstileSiteKey: true}});
  const siteKey = row?.turnstileSiteKey?.trim();
  return siteKey ? {siteKey, secret} : null;
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
  const [turnstile, token] = await Promise.all([turnstileFor(db, form.settings), renderToken(secret, form.id)]);
  return {
    ...base,
    status: 'live',
    versionId: form.versionId,
    version: form.version,
    definition: form.definition,
    renderToken: token,
    turnstileSiteKey: turnstile?.siteKey ?? null,
  };
}

/** Full GET answer for a slug, or null for a 404. Shared by the API route and the /f/[slug] page. */
export async function payloadForSlug(db: Db, secret: string, slug: string, unlock?: string | null): Promise<PublicFormResponse | null> {
  const r = await loadBySlug(db, slug);
  if (r.kind === 'missing') return null;
  if (r.kind === 'moved') return {status: 'moved', redirectTo: r.slug};
  return publicPayload(db, secret, r.form, unlock);
}
