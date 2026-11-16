import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * PRD "Templates" acceptance: every built-in template publishes and accepts a test response
 * with no edits. For each one: create a form from it (API), publish, generate a valid answer
 * set from the field-type registry (respecting logic), submit through the public route, then
 * check the stored row, forms.response_count and the summary endpoint. Plus one invalid
 * submission per template, rejected with field errors.
 *
 * Base database: TEST_DATABASE_URL (CI) or intelform_k locally; one fresh DB for this file.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_k'
process.env.TEST_APP_URL ??= 'http://localhost:5191'

const { setupTestDb, setupOwner } = await import('./harness')
const ctx = await setupTestDb()
const { sql } = ctx
const { BUILTIN_TEMPLATES } = await import('../../shared/form/templates')
const { formDefinition } = await import('../../shared/form/definition')
const { renderToken } = await import('../respondent/tokens')
const { validAnswers, visibleRequired } = await import('../../e2e/helpers/answers')

type Owner = Awaited<ReturnType<typeof setupOwner>>
let owner: Owner

beforeAll(async () => {
  owner = await setupOwner(ctx)
})
afterAll(async () => {
  await ctx.teardown()
})

/** A submit body the way the browser builds it, with a render token old enough to pass the minimum fill time. */
function submitBody(formId: string, versionId: string, answers: Record<string, unknown>) {
  return {
    formVersionId: versionId,
    answers,
    renderToken: renderToken(formId, Date.now() - 10_000),
    startedAt: Date.now() - 8_000,
    hp: '',
  }
}

describe.each(BUILTIN_TEMPLATES.map((t) => [t.name, t] as const))('template %s', (_name, tpl) => {
  let form: { id: string; slug: string }
  let live: { versionId: string; definition: unknown; renderToken: string }

  it('creates a form from the template and publishes it with no edits', async () => {
    const created = await owner.post('/api/forms', { templateSlug: tpl.slug })
    expect(created.status, created.text).toBe(201)
    form = created.body
    expect(created.body.title).toBe(tpl.name)

    const published = await owner.post(`/api/forms/${form.id}/publish`, {})
    expect(published.status, published.text).toBe(200)
    expect(published.body.status).toBe('live')

    // A respondent (no cookies) gets the live definition.
    const anon = ctx.client()
    const got = await anon.get(`/api/public/forms/${form.slug}`)
    expect(got.status, got.text).toBe(200)
    expect(got.body.status).toBe('live')
    expect(got.body.turnstileSiteKey).toBeNull()
    live = got.body
    expect(typeof live.renderToken).toBe('string')
  })

  it('accepts a generated valid response', async () => {
    const def = formDefinition.parse(live.definition)
    const answers = validAnswers(def, { seed: `${tpl.slug}-ok` })
    expect(Object.keys(answers).length).toBeGreaterThan(0)

    const anon = ctx.client()
    const res = await anon.post(`/api/public/forms/${form.slug}/responses`, submitBody(form.id, live.versionId, answers))
    expect(res.status, res.text).toBe(200)
    expect(res.body.ok).toBe(true)

    const rows = await sql<{ answers: Record<string, unknown>; form_version_id: string }[]>`
      SELECT answers, form_version_id FROM responses WHERE form_id = ${form.id}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].form_version_id).toBe(live.versionId)
    // Every generated answer was stored (normalised), and nothing else.
    expect(Object.keys(rows[0].answers).sort()).toEqual(Object.keys(answers).sort())

    const [{ response_count }] = await sql<{ response_count: number }[]>`SELECT response_count FROM forms WHERE id = ${form.id}`
    expect(response_count).toBe(1)

    const summary = await owner.get(`/api/forms/${form.id}/summary?range=all`)
    expect(summary.status, summary.text).toBe(200)
    expect(summary.body.totals.responses).toBe(1)
    expect(summary.body.formTotal).toBe(1)

    const detail = await owner.get(`/api/forms/${form.id}`)
    expect(detail.body.counts.responses).toBe(1)
  })

  it('rejects an invalid response with field errors', async () => {
    const def = formDefinition.parse(live.definition)
    const required = visibleRequired(def)
    expect(required.length).toBeGreaterThan(0)

    // Nothing answered, plus a malformed email where the form has one.
    const answers: Record<string, unknown> = {}
    const email = def.fields.find((f) => f.type === 'email')
    if (email) answers[email.id] = 'not-an-email'

    const anon = ctx.client()
    const res = await anon.post(`/api/public/forms/${form.slug}/responses`, submitBody(form.id, live.versionId, answers))
    expect(res.status, res.text).toBe(422)
    expect(res.body.error.code).toBe('validation_failed')
    const fields = res.body.error.fields as Record<string, string[]>
    for (const id of required) if (id !== email?.id) expect(fields[id], `error for ${id}`).toBeDefined()
    if (email) expect(fields[email.id]?.[0]).toBeTruthy()

    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM responses WHERE form_id = ${form.id}`
    expect(n).toBe(1)
    const [{ response_count }] = await sql<{ response_count: number }[]>`SELECT response_count FROM forms WHERE id = ${form.id}`
    expect(response_count).toBe(1)
  })
})

describe('logic branches', () => {
  it('NPS: the low-score follow-up is the one that is answered, and a hidden answer is rejected', async () => {
    const created = await owner.post('/api/forms', { templateSlug: 'builtin-nps', title: 'NPS branches' })
    expect(created.status).toBe(201)
    const { id, slug } = created.body
    expect((await owner.post(`/api/forms/${id}/publish`, {})).status).toBe(200)
    const live = (await ctx.client().get(`/api/public/forms/${slug}`)).body
    const def = formDefinition.parse(live.definition)
    const [score, low, high] = def.fields

    const answers = validAnswers(def, { byType: { nps: 3 } })
    expect(answers[low.id]).toBeDefined()
    expect(answers[high.id]).toBeUndefined()
    const ok = await ctx.client().post(`/api/public/forms/${slug}/responses`, submitBody(id, live.versionId, answers))
    expect(ok.status, ok.text).toBe(200)

    const hidden = await ctx.client().post(`/api/public/forms/${slug}/responses`, submitBody(id, live.versionId, { ...answers, [high.id]: 'Hidden answer' }))
    expect(hidden.status).toBe(422)
    expect(Object.keys(hidden.body.error.fields)).toEqual([high.id])
    expect(score.type).toBe('nps')
  })
})

describe('integrity', () => {
  it('there are exactly 10 built-in templates', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(10)
  })
})

