import { randomInt } from 'node:crypto'
import { Hono, type Context } from 'hono'
import type { JSONValue } from 'postgres'
import { z } from 'zod'
import {
  createFormInput,
  deleteFormInput,
  formPatchInput,
  formsListQuery,
  formsViewInput,
  saveAsTemplateInput,
  type CreatedForm,
  type FormDetail,
  type FormListItem,
  type FormPatchResponse,
  type FormsListResponse,
  type FormStatus,
  type FormStatusResponse,
  type FormsView,
  type FormsViewResponse,
  type LogicIssueBody,
  type PublishResponse,
  type TemplateSummary,
} from '../../shared/api-forms'
import type { ApiErrorBody } from '../../shared/api'
import { blankDefinition, formDefinition, type FormDefinition } from '../../shared/form/definition'
import { lintLogic } from '../../shared/form/logic'
import { clientSettings, copyableSettings, defaultFormSettings, formSettings, type FormSettings } from '../../shared/form/settings'
import { defaultTheme, formTheme, themePreset, type FormTheme } from '../../shared/form/theme'
import { remapTemplateIds } from '../../shared/form/templates/remap'
import { coreRegistry } from '../../shared/form/types/registry'
import { sql, type Queryable } from '../db/client'
import { ensureBuiltinTemplates } from '../db/seed'
import { ApiError, notFound } from '../lib/errors'
import { hashPassword } from '../lib/password'
import { assertSafeUrl } from '../lib/webhooks'
import { getSetting } from '../lib/settings'
import { removeSignatureDir } from '../lib/uploads'
import { readBody, uuidParam, UUID_RE } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

/** Dashboard forms: list, create, read, autosave, publish, close/reopen, duplicate, rename, delete, save-as-template. Owned by: Agent D (forms) (see docs/AGENTS.md). */
export const formsRoutes = new Hono<AppEnv>().use(requireUser)

const GONE = 'That form no longer exists'
const json = (v: unknown) => sql.json(v as JSONValue)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSlug(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]
  return s
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

/**
 * Inserts a form with a fresh random 8-character slug, retrying on the (rare) collision with
 * a current slug or an old one that still redirects.
 */
async function insertForm(
  tx: Queryable,
  values: { title: string; draft: FormDefinition; theme: FormTheme; settings: FormSettings; userId: string },
): Promise<CreatedForm> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = randomSlug()
    const [old] = await tx`SELECT 1 FROM form_slugs_old WHERE slug = ${slug}`
    if (old) continue
    const rows = await tx<CreatedForm[]>`
      INSERT INTO forms (slug, title, status, draft, theme, settings, created_by, updated_by)
      VALUES (${slug}, ${values.title}, 'draft', ${json(values.draft)}, ${json(values.theme)}, ${json(values.settings)}, ${values.userId}, ${values.userId})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id, slug, title
    `
    if (rows[0]) return rows[0]
  }
  throw new ApiError(500, 'slug_exhausted', 'Couldn’t create a unique link. Try again.')
}

function zodFields(error: z.ZodError, prefix: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  for (const issue of error.issues.slice(0, 20)) {
    const key = [prefix, ...issue.path.map(String)].join('.')
    ;(fields[key] ??= []).push(issue.message)
  }
  return fields
}

/**
 * Autosave accepts drafts mid-edit: a field missing some of its type's props gets that type's
 * defaults instead of being rejected. Anything still invalid is a 422.
 */
export function normalizeDraft(raw: unknown): FormDefinition {
  const first = formDefinition.safeParse(raw)
  if (first.success) return first.data
  const repaired = repairDraft(raw)
  const second = formDefinition.safeParse(repaired)
  if (second.success) return second.data
  throw new ApiError(422, 'validation_failed', 'The form couldn’t be saved: some fields are invalid', zodFields(second.error, 'draft'))
}

function repairDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const base = blankDefinition() as unknown as Record<string, unknown>
  const draft = { ...base, ...(raw as Record<string, unknown>) }
  if (Array.isArray(draft.fields)) {
    draft.fields = draft.fields.map((f: unknown) => {
      if (!f || typeof f !== 'object') return f
      const field = f as Record<string, unknown>
      const core = (coreRegistry as Record<string, { defaultProps: () => unknown } | undefined>)[String(field.type)]
      if (!core) return field
      const props = field.props && typeof field.props === 'object' ? field.props : {}
      return { required: false, label: '', ...field, props: { ...(core.defaultProps() as object), ...props } }
    })
  }
  return draft
}

function parseTheme(raw: unknown): FormTheme {
  const result = formTheme.safeParse(raw)
  if (result.success) return result.data
  throw new ApiError(422, 'validation_failed', 'The design couldn’t be saved: check the theme settings', zodFields(result.error, 'theme'))
}

/** Stored settings, tolerant of old or partial rows. */
function readSettings(raw: unknown): FormSettings {
  const result = formSettings.safeParse(raw)
  return result.success ? result.data : defaultFormSettings()
}

function readTheme(raw: unknown): FormTheme {
  const result = formTheme.safeParse(raw)
  return result.success ? result.data : defaultTheme()
}

/**
 * App settings defaults for a new form: "Default theme for new forms" (a built-in preset id or a
 * saved theme's uuid; a deleted theme falls back to the built-in default) and the default timezone.
 */
async function newFormDefaults(): Promise<{ theme: FormTheme; timezone: string }> {
  const [{ defaultThemeId }, { timezone }] = await Promise.all([getSetting('branding'), getSetting('general')])
  let theme = defaultTheme()
  if (defaultThemeId) {
    const preset = themePreset(defaultThemeId)
    if (preset) theme = structuredClone(preset.theme)
    else if (UUID_RE.test(defaultThemeId)) {
      const [saved] = await sql<{ settings: unknown }[]>`SELECT settings FROM themes WHERE id = ${defaultThemeId}`
      if (saved) theme = readTheme(saved.settings)
    }
  }
  return { theme, timezone }
}

/** If-Match: "12", W/"12" or 12. Anything else means no revision check. */
function ifMatchRevision(c: Context): number | null {
  const header = c.req.header('if-match')
  const m = header?.match(/^(?:W\/)?"?(\d{1,9})"?$/)
  return m ? Number(m[1]) : null
}

function countFields(def: FormDefinition) {
  const fields = def.fields.filter((f) => f.type !== 'section_break').length
  const logicRules = def.fields.filter((f) => !!f.logic).length
  return { fields, logicRules }
}

interface FormRow {
  id: string
  title: string
  slug: string
  status: FormStatus
  draft: unknown
  theme: unknown
  settings: unknown
  revision: number
  published_version_id: string | null
  has_unpublished: boolean
  created_at: Date
  updated_at: Date
  updated_by: string | null
}

async function loadForm(id: string, tx: Queryable = sql, lock = false): Promise<FormRow> {
  const [row] = lock
    ? await tx<FormRow[]>`SELECT * FROM forms WHERE id = ${id} FOR UPDATE`
    : await tx<FormRow[]>`SELECT * FROM forms WHERE id = ${id}`
  if (!row) throw notFound(GONE)
  return row
}

async function slugTaken(tx: Queryable, slug: string, formId: string): Promise<boolean> {
  const [row] = await tx`
    SELECT 1 FROM forms WHERE slug = ${slug} AND id <> ${formId}
    UNION ALL
    SELECT 1 FROM form_slugs_old WHERE slug = ${slug} AND form_id <> ${formId}
    LIMIT 1
  `
  return !!row
}

const slugTakenError = () =>
  new ApiError(422, 'validation_failed', 'That link is taken', { slug: ['That link is already used by another form. Try another.'] })

// ---------------------------------------------------------------------------
// List and the weekly strip
// ---------------------------------------------------------------------------

formsRoutes.get('/', requirePermission('forms.view'), async (c) => {
  const parsed = formsListQuery.safeParse(c.req.query())
  const query = parsed.success ? parsed.data : formsListQuery.parse({})

  const search = query.q ? `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null
  const order = {
    updated: sql`f.updated_at DESC`,
    created: sql`f.created_at DESC`,
    title: sql`lower(f.title) ASC, f.created_at DESC`,
    responses: sql`f.response_count DESC, f.updated_at DESC`,
  }[query.sort]

  const rows = await sql<(Omit<FormListItem, 'completionRate'> & { starts: number })[]>`
    SELECT f.id, f.title, f.slug, f.status,
      COALESCE(f.draft->>'layout', 'all_at_once') AS layout,
      f.response_count AS "responseCount",
      COALESCE(e.n, 0)::int AS starts,
      (f.has_unpublished AND f.published_version_id IS NOT NULL) AS "hasUnpublished",
      f.created_at AS "createdAt", f.updated_at AS "updatedAt"
    FROM forms f
    LEFT JOIN (SELECT form_id, count(*) AS n FROM form_events WHERE type = 'start' GROUP BY form_id) e ON e.form_id = f.id
    WHERE true
      ${query.status !== 'all' ? sql`AND f.status = ${query.status}` : sql``}
      ${search ? sql`AND f.title ILIKE ${search}` : sql``}
    ORDER BY ${order}
  `

  const forms: FormListItem[] = rows.map(({ starts, ...r }) => ({
    ...r,
    completionRate: starts > 0 ? Math.min(1, r.responseCount / starts) : null,
  }))

  const [[{ total }], [week], mostActive] = await Promise.all([
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM forms`,
    sql<{ this_week: number; last_week: number }[]>`
      SELECT
        count(*) FILTER (WHERE submitted_at >= now() - interval '7 days')::int AS this_week,
        count(*) FILTER (WHERE submitted_at < now() - interval '7 days')::int AS last_week
      FROM responses WHERE submitted_at >= now() - interval '14 days'
    `,
    sql<{ id: string; title: string; count: number }[]>`
      SELECT f.id, f.title, count(*)::int AS count
      FROM responses r JOIN forms f ON f.id = r.form_id
      WHERE r.submitted_at >= now() - interval '7 days'
      GROUP BY f.id, f.title
      ORDER BY count DESC, f.title
      LIMIT 3
    `,
  ])

  return c.json<FormsListResponse>({
    forms,
    total,
    strip: { responsesThisWeek: week.this_week, responsesLastWeek: week.last_week, mostActive },
  })
})

// ---------------------------------------------------------------------------
// Grid / list view, remembered per user
// ---------------------------------------------------------------------------

formsRoutes.get('/prefs/view', requirePermission('forms.view'), async (c) => {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM user_prefs WHERE user_id = ${c.var.user.id} AND key = 'forms.view'`
  const view: FormsView = row?.value === 'list' ? 'list' : 'grid'
  return c.json<FormsViewResponse>({ view })
})

formsRoutes.patch('/prefs/view', requirePermission('forms.view'), async (c) => {
  const { view } = await readBody(c, formsViewInput)
  await sql`
    INSERT INTO user_prefs (user_id, key, value) VALUES (${c.var.user.id}, 'forms.view', ${json(view)})
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `
  return c.json<FormsViewResponse>({ view })
})

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

formsRoutes.post('/', requirePermission('forms.edit'), async (c) => {
  const input = await readBody(c, createFormInput)
  const userId = c.var.user.id

  let title = input.title ?? 'Untitled form'
  let draft = blankDefinition()
  const appDefaults = await newFormDefaults()
  let theme = appDefaults.theme
  let settings = { ...defaultFormSettings(), timezone: appDefaults.timezone }

  if (input.templateId || input.templateSlug) {
    await ensureBuiltinTemplates()
    const [tpl] = input.templateId
      ? await sql<{ name: string; definition: unknown; theme: unknown; settings: unknown }[]>`
          SELECT name, definition, theme, settings FROM templates WHERE id = ${input.templateId}`
      : await sql<{ name: string; definition: unknown; theme: unknown; settings: unknown }[]>`
          SELECT name, definition, theme, settings FROM templates WHERE slug = ${input.templateSlug ?? ''}`
    if (!tpl) throw notFound('That template no longer exists')
    title = input.title ?? tpl.name
    if (tpl.theme && Object.keys(tpl.theme as object).length) theme = readTheme(tpl.theme)
    // Fresh field and option ids per form, with logic, pipes and settings references rewritten.
    ;({ definition: draft, settings } = remapTemplateIds(normalizeDraft(tpl.definition), copyableSettings(readSettings(tpl.settings), true)))
    if (!settings.closeAt) settings = { ...settings, timezone: appDefaults.timezone }
  }

  const created = await insertForm(sql, { title, draft, theme, settings, userId })
  return c.json<CreatedForm>(created, 201)
})

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

formsRoutes.get('/:id', requirePermission('forms.view'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const [row] = await sql<
    (FormRow & { published_version: number | null; published_at: Date | null; responses: number; updated_by_name: string | null })[]
  >`
    SELECT f.*, v.version AS published_version, v.published_at,
      f.response_count AS responses,
      u.name AS updated_by_name
    FROM forms f
    LEFT JOIN form_versions v ON v.id = f.published_version_id
    LEFT JOIN users u ON u.id = f.updated_by
    WHERE f.id = ${id}
  `
  if (!row) throw notFound(GONE)

  const draftResult = formDefinition.safeParse(row.draft)
  const draft = draftResult.success ? draftResult.data : repairOrBlank(row.draft)
  const detail: FormDetail = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    draft,
    theme: readTheme(row.theme),
    settings: clientSettings(readSettings(row.settings)),
    revision: row.revision,
    publishedVersion: row.published_version,
    publishedAt: row.published_at?.toISOString() ?? null,
    hasUnpublished: row.has_unpublished && row.published_version_id !== null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by && row.updated_by_name ? { id: row.updated_by, name: row.updated_by_name } : null,
    counts: { ...countFields(draft), responses: row.responses },
  }
  return c.json(detail)
})

function repairOrBlank(raw: unknown): FormDefinition {
  try {
    return normalizeDraft(raw)
  } catch {
    return blankDefinition()
  }
}

// ---------------------------------------------------------------------------
// Autosave (last save wins)
// ---------------------------------------------------------------------------

formsRoutes.patch('/:id', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const input = await readBody(c, formPatchInput)
  const expected = ifMatchRevision(c)
  const userId = c.var.user.id

  // Validate and hash outside the transaction so the row lock is short.
  const draft = input.draft !== undefined ? normalizeDraft(input.draft) : undefined
  const theme = input.theme !== undefined ? parseTheme(input.theme) : undefined
  const { password, ...settingsPatch } = input.settings ?? {}
  // SSRF: refuse private, loopback and local-name targets when saving, not only when sending.
  if (settingsPatch.webhook?.url) {
    try {
      assertSafeUrl(settingsPatch.webhook.url)
    } catch (err) {
      if (err instanceof ApiError) throw new ApiError(422, 'validation_failed', err.message, { 'settings.webhook.url': [err.message] })
      throw err
    }
  }
  const passwordHash = typeof password === 'string' ? await hashPassword(password) : password

  const result = await sql.begin(async (tx) => {
    const row = await loadForm(id, tx, true)

    let overwrittenBy: FormPatchResponse['overwrittenBy'] = null
    const overwrote = expected !== null && expected !== row.revision
    if (overwrote && row.updated_by) {
      const [u] = await tx<{ id: string; name: string }[]>`SELECT id, name FROM users WHERE id = ${row.updated_by}`
      overwrittenBy = u ?? null
    }

    let slug = row.slug
    if (input.slug !== undefined && input.slug !== row.slug) {
      if (await slugTaken(tx, input.slug, id)) throw slugTakenError()
      await tx`DELETE FROM form_slugs_old WHERE slug = ${input.slug} AND form_id = ${id}`
      await tx`INSERT INTO form_slugs_old (slug, form_id) VALUES (${row.slug}, ${id}) ON CONFLICT (slug) DO NOTHING`
      slug = input.slug
    }

    let settings: FormSettings | undefined
    let status = row.status
    if (input.settings !== undefined) {
      const current = readSettings(row.settings)
      const merged: Record<string, unknown> = { ...current, ...settingsPatch }
      if (settingsPatch.webhook) merged.webhook = { ...current.webhook, ...settingsPatch.webhook }
      if (password !== undefined) merged.passwordHash = passwordHash ?? null
      const parsed = formSettings.safeParse(merged)
      if (!parsed.success) {
        throw new ApiError(422, 'validation_failed', 'Check the highlighted settings', zodFields(parsed.error, 'settings'))
      }
      settings = parsed.data
      // "Close form now" and the status move together.
      if (settings.closed && row.status === 'live') status = 'closed'
      if (!settings.closed && current.closed && row.status === 'closed' && row.published_version_id) status = 'live'
    }

    try {
      const [updated] = await tx<{ revision: number; has_unpublished: boolean; published_version_id: string | null }[]>`
        UPDATE forms SET
          title = ${input.title ?? row.title},
          slug = ${slug},
          status = ${status},
          ${draft !== undefined ? sql`draft = ${json(draft)},` : sql``}
          ${theme !== undefined ? sql`theme = ${json(theme)},` : sql``}
          ${settings !== undefined ? sql`settings = ${json(settings)},` : sql``}
          has_unpublished = has_unpublished
            OR ${draft !== undefined ? sql`draft IS DISTINCT FROM ${json(draft)}` : sql`false`}
            OR ${theme !== undefined ? sql`theme IS DISTINCT FROM ${json(theme)}` : sql`false`},
          revision = revision + 1,
          updated_by = ${userId},
          updated_at = now()
        WHERE id = ${id}
        RETURNING revision, has_unpublished, published_version_id
      `
      return {
        revision: updated.revision,
        overwrote,
        overwrittenBy,
        hasUnpublished: updated.has_unpublished && updated.published_version_id !== null,
        slug,
        status,
        settings: settings ? clientSettings(settings) : undefined,
      } satisfies FormPatchResponse
    } catch (err) {
      if (isUniqueViolation(err)) throw slugTakenError()
      throw err
    }
  })

  return c.json<FormPatchResponse>(result)
})

// ---------------------------------------------------------------------------
// Publish, close, reopen
// ---------------------------------------------------------------------------

formsRoutes.post('/:id/publish', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const userId = c.var.user.id

  const result = await sql.begin(async (tx) => {
    const row = await loadForm(id, tx, true)
    const parsed = formDefinition.safeParse(row.draft)
    if (!parsed.success) {
      throw new ApiError(422, 'validation_failed', 'Fix the highlighted fields before you publish', zodFields(parsed.error, 'draft'))
    }
    const definition = parsed.data
    if (definition.fields.filter((f) => f.type !== 'section_break').length === 0) {
      throw new ApiError(422, 'empty_form', 'Add at least one question before you publish')
    }
    const issues = lintLogic(definition)
    if (issues.length > 0) return { issues }

    const [{ next }] = await tx<{ next: number }[]>`
      SELECT COALESCE(max(version), 0) + 1 AS next FROM form_versions WHERE form_id = ${id}
    `
    const [version] = await tx<{ id: string; version: number; published_at: Date }[]>`
      INSERT INTO form_versions (form_id, version, definition, theme, published_by)
      VALUES (${id}, ${next}, ${json(definition)}, ${json(readTheme(row.theme))}, ${userId})
      RETURNING id, version, published_at
    `
    // A closed form stays closed: publishing a fix must not reopen it by surprise. Reopen does that.
    const status: FormStatus = row.status === 'closed' ? 'closed' : 'live'
    await tx`
      UPDATE forms SET
        published_version_id = ${version.id},
        status = ${status},
        has_unpublished = false,
        revision = revision + 1,
        updated_by = ${userId},
        updated_at = now()
      WHERE id = ${id}
    `
    return { version: version.version, publishedAt: version.published_at.toISOString(), status } satisfies PublishResponse
  })
  if ('issues' in result && result.issues) {
    const body: ApiErrorBody & { error: LogicIssueBody } = {
      error: { code: 'logic_issues', message: 'Fix the logic rules listed before you publish', issues: result.issues },
    }
    return c.json(body, 422)
  }
  return c.json<PublishResponse>(result)
})

formsRoutes.post('/:id/close', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const [row] = await sql<{ status: FormStatus }[]>`
    UPDATE forms SET status = 'closed', settings = settings || '{"closed": true}'::jsonb,
      revision = revision + 1, updated_by = ${c.var.user.id}, updated_at = now()
    WHERE id = ${id} AND status IN ('live', 'closed')
    RETURNING status
  `
  if (!row) {
    await loadForm(id)
    throw new ApiError(409, 'not_published', 'Publish the form before you close it')
  }
  return c.json<FormStatusResponse>({ status: row.status })
})

formsRoutes.post('/:id/reopen', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  // A close date already in the past would close it again at once, so reopening clears it.
  const [row] = await sql<{ status: FormStatus }[]>`
    UPDATE forms SET status = 'live',
      settings = settings || jsonb_build_object('closed', false)
        || CASE WHEN intelform_try_timestamptz(settings->>'closeAt') <= now()
             THEN '{"closeAt": null}'::jsonb ELSE '{}'::jsonb END,
      revision = revision + 1, updated_by = ${c.var.user.id}, updated_at = now()
    WHERE id = ${id} AND status IN ('closed', 'live') AND published_version_id IS NOT NULL
      -- COALESCE: with no responseCap key at all the comparison is NULL, which would block the update.
      AND NOT COALESCE(jsonb_typeof(settings->'responseCap') = 'number' AND response_count >= (settings->>'responseCap')::numeric, false)
    RETURNING status
  `
  if (!row) {
    const form = await loadForm(id)
    // At its cap the form would close again on the next read: say what to change instead.
    if (form.published_version_id && ['closed', 'live'].includes(form.status)) {
      throw new ApiError(409, 'cap_reached', 'Raise or remove the response cap first')
    }
    throw new ApiError(409, 'not_published', 'Publish the form before you reopen it')
  }
  return c.json<FormStatusResponse>({ status: row.status })
})

// ---------------------------------------------------------------------------
// Duplicate, save as template, delete
// ---------------------------------------------------------------------------

formsRoutes.post('/:id/duplicate', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const row = await loadForm(id)
  // Copies the definition, theme and settings only: never responses or the webhook secret.
  const created = await insertForm(sql, {
    title: `Copy of ${row.title}`.slice(0, 200),
    draft: repairOrBlank(row.draft),
    theme: readTheme(row.theme),
    settings: copyableSettings(readSettings(row.settings)),
    userId: c.var.user.id,
  })
  return c.json<CreatedForm>(created, 201)
})

formsRoutes.post('/:id/save-as-template', requirePermission('templates.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const input = await readBody(c, saveAsTemplateInput)
  const row = await loadForm(id)
  const definition = repairOrBlank(row.draft)

  const [tpl] = await sql<TemplateSummary[]>`
    INSERT INTO templates (slug, name, category, description, definition, theme, settings, is_builtin, created_by, sort_order)
    VALUES (
      ${`saved-${randomSlug()}${randomSlug().slice(0, 4)}`},
      ${input.name ?? row.title},
      ${input.category ?? 'Saved'},
      ${input.description ?? ''},
      ${json(definition)},
      ${json(readTheme(row.theme))},
      ${json(copyableSettings(readSettings(row.settings), true))},
      false, ${c.var.user.id}, 1000
    )
    RETURNING id, slug, name, category, description, is_builtin AS "isBuiltin",
      ${definition.layout}::text AS layout, ${countFields(definition).fields}::int AS "fieldCount",
      ${c.var.user.name}::text AS "createdBy", created_at AS "createdAt"
  `
  return c.json<TemplateSummary>(tpl, 201)
})

formsRoutes.delete('/:id', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const { confirmTitle } = await readBody(c, deleteFormInput)
  const row = await loadForm(id)
  if (confirmTitle.trim() !== row.title.trim()) {
    throw new ApiError(422, 'validation_failed', 'Type the form title to confirm', {
      confirmTitle: ['Type the form title exactly as shown'],
    })
  }
  // Cascades to versions, responses, events, webhook deliveries and old slugs.
  await sql`DELETE FROM forms WHERE id = ${id}`
  // Then the responses' signature PNGs (logged, not failed, if storage is down).
  await removeSignatureDir(id)
  return c.body(null, 204)
})
