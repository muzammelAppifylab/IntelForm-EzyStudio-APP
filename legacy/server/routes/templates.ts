import { Hono } from 'hono'
import { templatePatchInput, type TemplateSummary, type TemplatesResponse } from '../../shared/api-forms'
import { sql } from '../db/client'
import { ensureBuiltinTemplates } from '../db/seed'
import { ApiError, notFound } from '../lib/errors'
import { readBody, uuidParam } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

/** Templates page: list built-in and saved templates, rename/delete saved ones. Owned by: Agent D (forms) (see docs/AGENTS.md). */
export const templatesRoutes = new Hono<AppEnv>().use(requireUser)

const GONE = 'That template no longer exists'
const builtinLocked = () => new ApiError(403, 'builtin_template', 'Built-in templates can’t be changed. Use it, then save your copy as a template.')

templatesRoutes.get('/', requirePermission('forms.view'), async (c) => {
  await ensureBuiltinTemplates()
  const templates = await sql<TemplateSummary[]>`
    SELECT t.id, t.slug, t.name, t.category, t.description, t.is_builtin AS "isBuiltin",
      COALESCE(t.definition->>'layout', 'all_at_once') AS layout,
      (SELECT count(*)::int FROM jsonb_array_elements(COALESCE(t.definition->'fields', '[]'::jsonb)) f
        WHERE f->>'type' <> 'section_break') AS "fieldCount",
      u.name AS "createdBy", t.created_at AS "createdAt"
    FROM templates t LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.is_builtin DESC, t.sort_order, t.created_at DESC
  `
  const categories = [...new Set(templates.map((t) => t.category))]
  return c.json<TemplatesResponse>({ templates, categories })
})

templatesRoutes.patch('/:id', requirePermission('templates.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const input = await readBody(c, templatePatchInput)
  const [row] = await sql<{ is_builtin: boolean }[]>`SELECT is_builtin FROM templates WHERE id = ${id}`
  if (!row) throw notFound(GONE)
  if (row.is_builtin) throw builtinLocked()
  await sql`
    UPDATE templates SET
      name = ${input.name},
      category = COALESCE(${input.category ?? null}, category),
      description = COALESCE(${input.description ?? null}, description),
      updated_at = now()
    WHERE id = ${id} AND NOT is_builtin
  `
  return c.json({ ok: true })
})

templatesRoutes.delete('/:id', requirePermission('templates.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const [row] = await sql<{ is_builtin: boolean }[]>`SELECT is_builtin FROM templates WHERE id = ${id}`
  if (!row) throw notFound(GONE)
  if (row.is_builtin) throw builtinLocked()
  await sql`DELETE FROM templates WHERE id = ${id} AND NOT is_builtin`
  return c.body(null, 204)
})
