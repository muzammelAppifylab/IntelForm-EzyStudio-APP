import { Hono } from 'hono'
import type { JSONValue } from 'postgres'
import { saveThemeInput, type SavedTheme, type SavedThemesResponse } from '../../shared/api-builder'
import { formTheme } from '../../shared/form/theme'
import { sql } from '../db/client'
import { notFound } from '../lib/errors'
import { readBody, uuidParam } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

/**
 * Saved form themes (PRD "Theme → Saved themes"): GET for everyone, POST/DELETE for Owner and
 * Editor. Owned by: Agent F (builder) (see docs/AGENTS.md).
 *
 */
export const themesRoutes = new Hono<AppEnv>()


const themes = new Hono<AppEnv>().use(requireUser)

themes.get('/', requirePermission('forms.view'), async (c) => {
  const rows = await sql<{ id: string; name: string; settings: unknown; created_by: string | null; created_at: Date }[]>`
    SELECT t.id, t.name, t.settings, u.name AS created_by, t.created_at
    FROM themes t LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.created_at DESC
    LIMIT 200
  `
  const list: SavedTheme[] = []
  for (const r of rows) {
    const parsed = formTheme.safeParse(r.settings)
    if (!parsed.success) continue
    list.push({ id: r.id, name: r.name, settings: parsed.data, createdBy: r.created_by, createdAt: r.created_at.toISOString() })
  }
  return c.json<SavedThemesResponse>({ themes: list })
})

themes.post('/', requirePermission('forms.edit'), async (c) => {
  const input = await readBody(c, saveThemeInput)
  const [row] = await sql<{ id: string; created_at: Date }[]>`
    INSERT INTO themes (name, settings, created_by)
    VALUES (${input.name}, ${sql.json(input.settings as unknown as JSONValue)}, ${c.var.user.id})
    RETURNING id, created_at
  `
  return c.json<SavedTheme>(
    { id: row.id, name: input.name, settings: input.settings, createdBy: c.var.user.name, createdAt: row.created_at.toISOString() },
    201,
  )
})

themes.delete('/:id', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', 'That theme no longer exists')
  const rows = await sql`DELETE FROM themes WHERE id = ${id}`
  if (rows.count === 0) throw notFound('That theme no longer exists')
  return c.body(null, 204)
})

themesRoutes.route('/', themes)
