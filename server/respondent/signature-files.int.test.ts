import { existsSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canvasPng, chunk, dataUrl, png, rgbaChunks } from '../test/png-fixtures'

/**
 * Signature PNGs on disk (local driver): strict validation and the per-submit cap, cleanup
 * when the transaction fails, and deletion with the response, the form and data retention.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_e'
process.env.TEST_APP_URL ??= 'http://localhost:5185'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const { setupTestDb, setupOwner } = await import('../test/harness')
const ctx = await setupTestDb()
const { sql } = ctx
const { formDefinition } = await import('../../shared/form/definition')
const { defaultFormSettings } = await import('../../shared/form/settings')
const { defaultTheme } = await import('../../shared/form/theme')
const { renderToken } = await import('./tokens')
const { localFilePath, LOCAL_URL_PREFIX } = await import('../lib/uploads')
const { setSetting } = await import('../lib/settings')
const { applyRetention } = await import('../lib/scheduler')

let owner: Awaited<ReturnType<typeof setupOwner>>
beforeAll(async () => {
  owner = await setupOwner(ctx)
})
afterAll(() => ctx.teardown())

const SIGN_FIELDS = ['f_sig1', 'f_sig2', 'f_sig3', 'f_sig4']
const DEF = {
  layout: 'all_at_once',
  startScreen: { enabled: false, title: '', button: 'Start' },
  endScreen: { title: 'Thanks', message: '' },
  fields: [{ id: 'f_email', type: 'email', label: 'Email' }, ...SIGN_FIELDS.map((id) => ({ id, type: 'signature', label: 'Sign' }))],
}

let seq = 0
async function makeForm(settings: Json = {}) {
  const slug = `sig-${++seq}-${Math.random().toString(36).slice(2, 8)}`
  const title = `Signatures ${seq}`
  const definition = formDefinition.parse(DEF)
  const [form] = await sql<{ id: string }[]>`
    INSERT INTO forms (slug, title, status, draft, settings, theme)
    VALUES (${slug}, ${title}, 'live', ${sql.json(definition as never)}, ${sql.json({ ...defaultFormSettings(), turnstile: false, ...settings } as never)}, ${sql.json(defaultTheme() as never)})
    RETURNING id
  `
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${form.id}, 1, ${sql.json(definition as never)}, ${sql.json(defaultTheme() as never)}) RETURNING id
  `
  await sql`UPDATE forms SET published_version_id = ${v.id} WHERE id = ${form.id}`
  return { id: form.id, slug, title, versionId: v.id }
}

type Form = Awaited<ReturnType<typeof makeForm>>
const submit = (form: Form, answers: Json) =>
  ctx.client().post(`/api/public/forms/${form.slug}/responses`, {
    formVersionId: form.versionId,
    answers,
    renderToken: renderToken(form.id, Date.now() - 5000),
  })

const sigFiles = (formId: string) => {
  const dir = localFilePath(`intelform/signatures/${formId}`)!
  return existsSync(dir) ? readdirSync(dir).length : 0
}
const fileOf = (url: string) => localFilePath(url.slice(LOCAL_URL_PREFIX.length))!
async function storedUrls(formId: string): Promise<{ id: string; urls: string[] }[]> {
  const rows = await sql<{ id: string; answers: Json }[]>`SELECT id, answers FROM responses WHERE form_id = ${formId} ORDER BY submitted_at`
  return rows.map((r) => ({ id: r.id, urls: SIGN_FIELDS.map((f) => r.answers[f]?.url).filter(Boolean) }))
}

describe('signature uploads', () => {
  it('stores a real-size canvas signature', async () => {
    const form = await makeForm()
    const res = await submit(form, { f_sig1: { url: dataUrl(canvasPng(1400, 352)) } })
    expect(res.status).toBe(200)
    const [{ urls }] = await storedUrls(form.id)
    expect(existsSync(fileOf(urls[0]))).toBe(true)
  })

  it('rejects a PNG that carries extra data, and stores nothing', async () => {
    const form = await makeForm()
    const [head, ...rest] = rgbaChunks(20, 20)
    const smuggled = png([head, chunk('tEXt', Buffer.from('payload\0' + 'x'.repeat(1000))), ...rest])
    const res = await submit(form, { f_sig1: { url: dataUrl(canvasPng()) }, f_sig2: { url: dataUrl(smuggled) } })
    expect(res.status).toBe(422)
    expect(res.body.error.fields).toHaveProperty('f_sig2')
    const trailing = await submit(form, { f_sig1: { url: dataUrl(Buffer.concat([canvasPng(), Buffer.from('<?php echo 1; ?>')])) } })
    expect(trailing.status).toBe(422)
    expect(sigFiles(form.id)).toBe(0)
  })

  it('caps the signatures of one submit at 1 MB together', async () => {
    const form = await makeForm()
    // Noise does not compress: each is ~290 KB, under the 400 KB data URL limit.
    const big = dataUrl(canvasPng(270, 270, true))
    expect(big.length).toBeLessThan(400_000)
    const res = await submit(form, Object.fromEntries(SIGN_FIELDS.map((f) => [f, { url: big }])))
    expect(res.status).toBe(413)
    expect(sigFiles(form.id)).toBe(0)
    expect((await submit(form, { f_sig1: { url: big }, f_sig2: { url: big } })).status).toBe(200)
  })

  it('deletes the stored signatures when the transaction fails', async () => {
    const form = await makeForm()
    await sql.unsafe(`
      CREATE FUNCTION fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
      CREATE TRIGGER fail_insert BEFORE INSERT ON responses FOR EACH ROW WHEN (NEW.form_id = '${form.id}') EXECUTE FUNCTION fail_insert();
    `)
    try {
      const res = await submit(form, { f_sig1: { url: dataUrl(canvasPng()) }, f_sig2: { url: dataUrl(canvasPng()) } })
      expect(res.status).toBe(500)
    } finally {
      await sql.unsafe('DROP TRIGGER fail_insert ON responses; DROP FUNCTION fail_insert();')
    }
    expect(sigFiles(form.id)).toBe(0)
  })
})

describe('signature files are deleted with their data', () => {
  const sign = { url: dataUrl(canvasPng(40, 20)) }

  it('on response delete and bulk delete', async () => {
    const form = await makeForm()
    for (let i = 0; i < 3; i++) expect((await submit(form, { f_sig1: sign, f_sig2: sign })).status).toBe(200)
    const rows = await storedUrls(form.id)
    expect(sigFiles(form.id)).toBe(6)

    expect((await owner.del(`/api/forms/${form.id}/responses/${rows[0].id}`)).status).toBe(200)
    for (const u of rows[0].urls) expect(existsSync(fileOf(u))).toBe(false)
    expect(sigFiles(form.id)).toBe(4)

    const bulk = await owner.post(`/api/forms/${form.id}/responses/bulk-delete`, { ids: [rows[1].id, rows[2].id] })
    expect(bulk.body).toEqual({ deleted: 2 })
    expect(sigFiles(form.id)).toBe(0)
  })

  it('on form delete', async () => {
    const form = await makeForm()
    expect((await submit(form, { f_sig1: sign })).status).toBe(200)
    expect(sigFiles(form.id)).toBe(1)
    expect((await owner.request('DELETE', `/api/forms/${form.id}`, { confirmTitle: form.title })).status).toBe(204)
    expect(existsSync(localFilePath(`intelform/signatures/${form.id}`)!)).toBe(false)
  })

  it('by data retention', async () => {
    const form = await makeForm()
    expect((await submit(form, { f_sig1: sign })).status).toBe(200)
    expect((await submit(form, { f_sig1: sign })).status).toBe(200)
    const [old, fresh] = await storedUrls(form.id)
    await sql`UPDATE responses SET submitted_at = now() - interval '40 days' WHERE id = ${old.id}`
    await setSetting('data', { retentionDays: 30 })
    try {
      expect(await applyRetention()).toBe(1)
    } finally {
      await setSetting('data', { retentionDays: null })
    }
    expect(existsSync(fileOf(old.urls[0]))).toBe(false)
    expect(existsSync(fileOf(fresh.urls[0]))).toBe(true)
  })
})
