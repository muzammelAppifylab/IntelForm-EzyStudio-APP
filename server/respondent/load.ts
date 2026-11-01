import type { PublicFormClosed, PublicFormLive, PublicFormLocked, PublicFormResponse } from '../../shared/api-public'
import { formDefinition, type FormDefinition } from '../../shared/form/definition'
import { SYSTEM_LABELS } from '../../shared/form/labels'
import { formSettings, publicSettings, type FormSettings } from '../../shared/form/settings'
import { defaultTheme, formTheme, type FormTheme } from '../../shared/form/theme'
import { sql, type Queryable } from '../db/client'
import { notFound } from '../lib/errors'
import { getTurnstileConfig } from '../lib/settings'
import { checkUnlockToken, renderToken } from './tokens'

/** A form as the respondent routes see it: the published version, parsed settings and status. */
export interface LoadedForm {
  id: string
  slug: string
  title: string
  status: 'draft' | 'live' | 'closed'
  responseCount: number
  settings: FormSettings
  versionId: string
  version: number
  definition: FormDefinition
  theme: FormTheme
}

interface FormRow {
  id: string
  slug: string
  title: string
  status: 'draft' | 'live' | 'closed'
  response_count: number
  settings: unknown
  published_version_id: string | null
  version: number | null
  definition: unknown
  theme: unknown
}

export type LoadResult = { kind: 'form'; form: LoadedForm } | { kind: 'moved'; slug: string } | { kind: 'missing' }

function parseTheme(raw: unknown): FormTheme {
  const r = formTheme.safeParse(raw && typeof raw === 'object' && Object.keys(raw).length ? raw : defaultTheme())
  return r.success ? r.data : defaultTheme()
}

function toLoaded(row: FormRow): LoadedForm | null {
  if (!row.published_version_id || row.version === null || row.status === 'draft') return null
  const def = formDefinition.safeParse(row.definition)
  if (!def.success) return null
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    responseCount: row.response_count,
    settings: formSettings.parse(row.settings),
    versionId: row.published_version_id,
    version: row.version,
    definition: def.data,
    theme: parseTheme(row.theme),
  }
}

/** Loads the published form for a public slug; old slugs answer with the current one. */
export async function loadBySlug(slug: string, tx: Queryable = sql): Promise<LoadResult> {
  const clean = slug.toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(clean)) return { kind: 'missing' }
  const [row] = await tx<FormRow[]>`
    SELECT f.id, f.slug, f.title, f.status, f.response_count, f.settings, f.published_version_id,
           v.version, v.definition, v.theme
    FROM forms f LEFT JOIN form_versions v ON v.id = f.published_version_id
    WHERE f.slug = ${clean}
  `
  if (row) {
    const form = toLoaded(row)
    return form ? { kind: 'form', form } : { kind: 'missing' }
  }
  const [old] = await tx<{ slug: string; status: string }[]>`
    SELECT f.slug, f.status FROM form_slugs_old o JOIN forms f ON f.id = o.form_id WHERE o.slug = ${clean}
  `
  if (old && old.status !== 'draft') return { kind: 'moved', slug: old.slug }
  return { kind: 'missing' }
}

/** Loads a form or throws the 404 every draft or unknown slug gets. */
export async function requireForm(slug: string, tx: Queryable = sql): Promise<LoadedForm> {
  const r = await loadBySlug(slug, tx)
  if (r.kind !== 'form') throw notFound('This form doesn’t exist')
  return r.form
}

/**
 * Just what isClosed needs, for hot paths like the view/start beacons: no published definition
 * or theme to read and parse. Same 404s as requireForm (drafts, unknown and old slugs).
 */
export async function requireFormMeta(slug: string): Promise<Pick<LoadedForm, 'id' | 'status' | 'responseCount' | 'settings'>> {
  const clean = slug.toLowerCase()
  const [row] = /^[a-z0-9][a-z0-9-]{0,80}$/.test(clean)
    ? await sql<{ id: string; status: LoadedForm['status']; response_count: number; settings: unknown }[]>`
        SELECT id, status, response_count, settings FROM forms
        WHERE slug = ${clean} AND published_version_id IS NOT NULL AND status <> 'draft'
      `
    : []
  if (!row) throw notFound('This form doesn’t exist')
  return { id: row.id, status: row.status, responseCount: row.response_count, settings: formSettings.parse(row.settings) }
}

/** Closed manually, past its close date, or at its response cap (checked at read time). */
export function isClosed(form: Pick<LoadedForm, 'status' | 'settings' | 'responseCount'>, now = Date.now()): boolean {
  if (form.status !== 'live') return true
  const { closeAt, responseCap } = form.settings
  if (closeAt && Date.parse(closeAt) <= now) return true
  if (responseCap !== null && form.responseCount >= responseCap) return true
  return false
}

/** Turnstile site key when this form uses it and the Owner configured both keys. */
export async function turnstileFor(settings: FormSettings): Promise<{ siteKey: string; secret: string } | null> {
  if (!settings.turnstile) return null
  const { siteKey, secret } = await getTurnstileConfig()
  return siteKey && secret ? { siteKey, secret } : null
}

/**
 * The GET payload. Password-protected forms return metadata only unless `unlock` is a valid
 * token; closed forms return the closed message, never the definition.
 */
export async function publicPayload(form: LoadedForm, unlock?: string | null): Promise<PublicFormLive | PublicFormClosed | PublicFormLocked> {
  const base = {
    id: form.id,
    slug: form.slug,
    title: form.title,
    theme: form.theme,
    settings: publicSettings(form.settings),
  }
  if (isClosed(form)) return { ...base, status: 'closed', message: form.settings.closedMessage || SYSTEM_LABELS.closed }
  const hash = form.settings.passwordHash
  if (hash && !checkUnlockToken(unlock, form.id, hash)) return { ...base, status: 'locked' }
  const turnstile = await turnstileFor(form.settings)
  return {
    ...base,
    status: 'live',
    versionId: form.versionId,
    version: form.version,
    definition: form.definition,
    renderToken: renderToken(form.id),
    turnstileSiteKey: turnstile?.siteKey ?? null,
  }
}

/** Full GET answer for a slug, or null for a 404. Shared by the API route and the HTML inliner. */
export async function payloadForSlug(slug: string, unlock?: string | null): Promise<PublicFormResponse | null> {
  const r = await loadBySlug(slug)
  if (r.kind === 'missing') return null
  if (r.kind === 'moved') return { status: 'moved', redirectTo: r.slug }
  return publicPayload(r.form, unlock)
}
