import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { JSONValue } from 'postgres'
import { formSettings } from '../../shared/form/settings'
import { BUILTIN_TEMPLATES } from '../../shared/form/templates'
import { defaultTheme } from '../../shared/form/theme'
import { sql as pool, type Queryable } from './client'

/** JSON with object keys sorted, so the hash ignores key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Upserts the built-in templates by slug. Idempotent: a row is written only when its
 * builtin_hash (sha256 of the canonical JSON) differs, built-ins no longer shipped are
 * deleted, and templates a team member saved are never touched. Returns rows written.
 */
export async function seedBuiltinTemplates(sql: Queryable = pool): Promise<{ written: number; deleted: number }> {
  const json = (v: unknown) => pool.json(v as JSONValue)
  let written = 0
  for (const t of BUILTIN_TEMPLATES) {
    const settings = formSettings.parse(t.settings ?? {})
    const theme = defaultTheme()
    const row = { name: t.name, category: t.category, description: t.description, sortOrder: t.sortOrder, definition: t.definition, settings, theme }
    const hash = createHash('sha256').update(canonical(row)).digest('hex')
    const result = await sql`
      INSERT INTO templates (slug, name, category, description, definition, theme, settings, is_builtin, sort_order, builtin_hash)
      VALUES (${t.slug}, ${t.name}, ${t.category}, ${t.description}, ${json(t.definition)}, ${json(theme)}, ${json(settings)}, true, ${t.sortOrder}, ${hash})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        definition = EXCLUDED.definition,
        theme = EXCLUDED.theme,
        settings = EXCLUDED.settings,
        sort_order = EXCLUDED.sort_order,
        builtin_hash = EXCLUDED.builtin_hash,
        updated_at = now()
      WHERE templates.is_builtin AND templates.builtin_hash IS DISTINCT FROM EXCLUDED.builtin_hash
    `
    written += result.count
  }
  const slugs = BUILTIN_TEMPLATES.map((t) => t.slug)
  const removed = await sql`DELETE FROM templates WHERE is_builtin AND NOT (slug = ANY(${slugs}))`
  return { written, deleted: removed.count }
}

let seeding: Promise<unknown> | null = null

/**
 * Makes sure the built-ins exist (seeds them when any is missing). One indexed count per
 * call, so routes that need templates can call it freely; boot calls seedBuiltinTemplates.
 */
/** Built-ins can't be deleted through the API, so once they're all there we stop checking. */
let seeded = false

export async function ensureBuiltinTemplates(): Promise<void> {
  if (seeded) return
  const [{ n }] = await pool<{ n: number }[]>`SELECT count(*)::int AS n FROM templates WHERE is_builtin`
  if (n >= BUILTIN_TEMPLATES.length) {
    seeded = true
    return
  }
  seeding ??= seedBuiltinTemplates().finally(() => {
    seeding = null
  })
  await seeding
}

// `tsx server/db/seed.ts` (npm run db:seed)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { written, deleted } = await seedBuiltinTemplates()
  console.log(`built-in templates: ${written} written, ${deleted} removed`)
  await pool.end()
}
