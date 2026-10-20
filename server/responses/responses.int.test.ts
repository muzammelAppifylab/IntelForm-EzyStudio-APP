import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { JSONValue } from 'postgres'

/**
 * Integration tests for the Responses API on a fresh, migrated database per run
 * (server/test/harness.ts). Locally the base is intelform_g; CI sets TEST_DATABASE_URL.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_g'
process.env.TEST_APP_URL ??= 'http://localhost:5187'

const { setupTestDb, setupOwner, addMember } = await import('../test/harness')
const { buildSearchText } = await import('./format')
const { insertBenchForm, insertFakeResponses } = await import('./fixtures')
const ctx = await setupTestDb()
const { sql } = ctx

type Client = Awaited<ReturnType<typeof setupOwner>>
let owner: Client
let viewer: Client
let editor: Client

// ------------------------------------------------------------------ Fixture: two versions

const OPT = { a: 'o_aaaa01', b: 'o_bbbb01', c: 'o_cccc01', x: 'o_xxxx01', y: 'o_yyyy01', z: 'o_zzzz01' }
const Q = {
  choice: 'f_choice01',
  multi: 'f_multi001',
  nps: 'f_nps00001',
  rating: 'f_rating01',
  num: 'f_number01',
  text: 'f_text0001',
  gone: 'f_gone0001',
  email: 'f_email001',
  name: 'f_name0001',
}

function definition(version: 1 | 2) {
  const choiceOptions = version === 1
    ? [{ id: OPT.a, label: 'Apple' }, { id: OPT.b, label: 'Banana' }, { id: OPT.c, label: 'Cherry' }]
    : [{ id: OPT.a, label: 'Apple' }, { id: OPT.b, label: 'Blueberry' }]
  return {
    layout: 'all_at_once',
    startScreen: { enabled: false, title: '', button: 'Start' },
    endScreen: { title: 'Thanks!', message: '' },
    labels: {},
    fields: [
      { id: Q.name, type: 'name', label: 'Your name', required: false, props: { split: true } },
      { id: Q.email, type: 'email', label: 'Email', required: false, props: {} },
      { id: Q.choice, type: 'single_choice', label: 'Favourite fruit', required: false, props: { options: choiceOptions, other: true } },
      { id: Q.multi, type: 'multiple_choice', label: 'Toppings', required: false, props: { options: [{ id: OPT.x, label: 'X' }, { id: OPT.y, label: 'Y' }, { id: OPT.z, label: 'Z' }] } },
      { id: Q.nps, type: 'nps', label: 'Recommend us?', required: false, props: {} },
      { id: Q.rating, type: 'rating', label: 'Rate us', required: false, props: { scale: 5 } },
      { id: Q.num, type: 'number', label: 'How many?', required: false, props: {} },
      { id: Q.text, type: 'short_text', label: version === 1 ? 'Old label' : 'New label', required: false, props: {} },
      ...(version === 1 ? [{ id: Q.gone, type: 'short_text', label: 'Removed question', required: false, props: {} }] : []),
    ],
  }
}

let formId = ''
const rid: string[] = []

async function seed() {
  const [form] = await sql<{ id: string }[]>`
    INSERT INTO forms (slug, title, status, draft) VALUES ('fruit-survey', 'Fruit survey', 'live', ${sql.json(definition(2) as JSONValue)}) RETURNING id
  `
  formId = form.id
  const [v1] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${formId}, 1, ${sql.json(definition(1) as JSONValue)}, '{}') RETURNING id
  `
  const [v2] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${formId}, 2, ${sql.json(definition(2) as JSONValue)}, '{}') RETURNING id
  `
  await sql`UPDATE forms SET published_version_id = ${v2.id} WHERE id = ${formId}`
  const rows: [string, Record<string, unknown>, Record<string, number> | null][] = [
    [v1.id, {
      [Q.name]: { first: 'Ada', last: 'Lovelace' }, [Q.email]: 'ada@example.com', [Q.choice]: { option: OPT.c },
      [Q.multi]: [{ option: OPT.x }, { option: OPT.y }], [Q.nps]: 10, [Q.rating]: 5, [Q.num]: 10,
      [Q.text]: 'hello, "world"', [Q.gone]: 'bye',
    }, { [Q.nps]: 1000, [Q.text]: 4000 }],
    [v1.id, {
      [Q.name]: { first: 'Grace', last: 'Hopper' }, [Q.choice]: { option: OPT.a }, [Q.multi]: [{ option: OPT.x }],
      [Q.nps]: 9, [Q.rating]: 4, [Q.num]: 20, [Q.text]: '=SUM(A1)',
    }, { [Q.nps]: 3000, [Q.text]: 2000 }],
    [v2.id, { [Q.choice]: { option: OPT.b }, [Q.multi]: [{ option: OPT.y }, { option: OPT.z }], [Q.nps]: 7, [Q.rating]: 3, [Q.num]: 30, [Q.text]: 'line1\nline2' }, { [Q.nps]: 2000 }],
    [v2.id, { [Q.choice]: { option: 'o_other', other: 'Durian' }, [Q.nps]: 0, [Q.rating]: 1, [Q.num]: 40 }, null],
    [v2.id, { [Q.choice]: { option: OPT.a }, [Q.nps]: 8, [Q.rating]: 2 }, null],
  ]
  const def2 = definition(2) as never
  // r0 oldest … r4 newest, one hour apart, all within the last day.
  for (let i = 0; i < rows.length; i++) {
    const [version, answers, ttc] = rows[i]
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO responses (form_id, form_version_id, answers, ttc, search_text, submitted_at, duration_ms, device, browser, country)
      VALUES (${formId}, ${version}, ${sql.json(answers as JSONValue)}, ${ttc ? sql.json(ttc) : null},
        ${buildSearchText((def2 as { fields: never[] }).fields, answers)},
        now() - ${`${5 - i} hours`}::interval, ${60_000 * (i + 1)}, ${i % 2 ? 'mobile' : 'desktop'}, 'Chrome', 'GB')
      RETURNING id
    `
    rid.push(r.id)
  }
  await sql`UPDATE forms SET response_count = 5, last_response_at = now() WHERE id = ${formId}`
  await sql`INSERT INTO form_event_counts (form_id, bucket, views, starts) VALUES (${formId}, date_bin('15 minutes', now(), '2000-01-01'), 20, 8)`
}

beforeAll(async () => {
  owner = await setupOwner(ctx)
  editor = await addMember(ctx, owner, 'editor')
  viewer = await addMember(ctx, owner, 'viewer')
  await seed()
}, 60_000)

afterAll(async () => {
  await ctx.teardown()
})

const base = () => `/api/forms/${formId}`

// ------------------------------------------------------------------ Summary

describe('summary', () => {
  it('computes cards, NPS, percentages, multi-choice and deleted fields', async () => {
    const res = await owner.get(`${base()}/summary?range=7d&tz=UTC`)
    expect(res.status).toBe(200)
    const s = res.body
    expect(s.totals).toMatchObject({ views: 20, starts: 8, responses: 5, completionRate: 5 / 8 })
    expect(s.totals.avgMs).toBe(180_000)
    expect(s.totals.medianMs).toBe(180_000)
    expect(s.series).toHaveLength(7)
    expect(s.series.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBe(5)

    const q = (id: string) => s.questions.find((x: { fieldId: string }) => x.fieldId === id)
    // NPS: 10, 9 promoters; 7, 8 passives; 0 detractor → (2 − 1) / 5 = +20.
    expect(q(Q.nps).data).toMatchObject({ kind: 'nps', score: 20, promoters: 2, passives: 2, detractors: 1 })
    expect(q(Q.nps).data.distribution[10]).toEqual({ value: 10, count: 1 })
    expect(q(Q.nps).medianTimeMs).toBe(2000)

    const choice = q(Q.choice).data
    expect(q(Q.choice).answered).toBe(5)
    expect(choice.options).toEqual([
      { id: OPT.a, label: 'Apple', count: 2, pct: 40 },
      { id: OPT.b, label: 'Blueberry', count: 1, pct: 20 },
      { id: OPT.c, label: 'Cherry (deleted option)', count: 1, pct: 20, deleted: true },
      { id: 'o_other', label: 'Other', count: 1, pct: 20, other: true },
    ])
    expect(choice.other.map((o: { text: string }) => o.text)).toEqual(['Durian'])

    // Multiple choice: % of the 3 who answered, so it adds up past 100.
    expect(q(Q.multi).data.options.map((o: { count: number; pct: number }) => [o.count, o.pct])).toEqual([[2, 66.7], [2, 66.7], [1, 33.3]])

    expect(q(Q.rating).data).toMatchObject({ kind: 'rating', average: 3, csat: 40 })
    expect(q(Q.num).data).toEqual({ kind: 'number', average: 25, min: 10, max: 40, median: 25 })

    const text = q(Q.text)
    expect(text.label).toBe('New label')
    expect(text.data.items.map((i: { text: string }) => i.text)).toEqual(['line1\nline2', '=SUM(A1)', 'hello, "world"'])

    const gone = q(Q.gone)
    expect(gone).toMatchObject({ deleted: true, label: 'Removed question (deleted)', answered: 1 })
    // Deleted fields come after the current ones.
    expect(s.questions.at(-1).fieldId).toBe(Q.gone)
  })

  it('custom ranges and time zones', async () => {
    const res = await owner.get(`${base()}/summary?range=custom&from=2020-01-01&to=2020-01-31&tz=Asia/Kathmandu`)
    expect(res.status).toBe(200)
    expect(res.body.series).toHaveLength(31)
    expect(res.body.totals.responses).toBe(0)
    expect(res.body.formTotal).toBe(5)
    expect(res.body.range.tz).toBe('Asia/Kathmandu')
    const bad = await owner.get(`${base()}/summary?range=custom&from=2020-02-01&to=2020-01-01`)
    expect(bad.status).toBe(422)
    const unknownTz = await owner.get(`${base()}/summary?tz=Mars/Base`)
    expect(unknownTz.body.range.tz).toBe('UTC')
  })

  it('caps a custom range at 3660 days and rejects dates that do not exist', async () => {
    const ok = await owner.get(`${base()}/summary?range=custom&from=2010-01-01&to=2020-01-08&tz=UTC`)
    expect(ok.status).toBe(200)
    expect(ok.body.series).toHaveLength(3660)
    const long = await owner.get(`${base()}/summary?range=custom&from=0001-01-01&to=9999-12-31`)
    expect(long.status).toBe(422)
    expect((await owner.get(`${base()}/summary?range=custom&from=2010-01-01&to=2020-01-09`)).status).toBe(422)
    expect((await owner.get(`${base()}/summary?range=custom&from=2026-13-45&to=2026-12-31`)).status).toBe(422)
    expect((await owner.get(`${base()}/summary?range=custom&from=2026-02-01&to=2026-02-30`)).status).toBe(422)
    expect((await owner.get(`${base()}/responses?from=2026-02-30`)).status).toBe(422)
  })
})

// ------------------------------------------------------------------ Table

describe('table', () => {
  it('lists newest first with the field catalog', async () => {
    const res = await viewer.get(`${base()}/responses`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(5)
    expect(res.body.rows.map((r: { id: string }) => r.id)).toEqual([...rid].reverse())
    const fields = res.body.fields
    expect(fields.map((f: { id: string }) => f.id)).toEqual([Q.name, Q.email, Q.choice, Q.multi, Q.nps, Q.rating, Q.num, Q.text, Q.gone])
    expect(fields.find((f: { id: string }) => f.id === Q.gone)).toMatchObject({ deleted: true, label: 'Removed question (deleted)' })
    expect(fields.find((f: { id: string }) => f.id === Q.choice).options.map((o: { label: string }) => o.label)).toEqual([
      'Apple', 'Blueberry', 'Cherry (deleted option)', 'Other',
    ])
    const oldest = res.body.rows.at(-1)
    expect(oldest.cells).toMatchObject({ [Q.name]: 'Ada Lovelace', [Q.choice]: 'Cherry (deleted option)', [Q.multi]: 'X; Y', [Q.gone]: 'bye' })
  })

  it('sorts by number, choice label and metadata with stable ties', async () => {
    const byNum = await owner.get(`${base()}/responses?sort=${Q.num}&dir=asc`)
    expect(byNum.body.rows.map((r: { cells: Record<string, string> }) => r.cells[Q.num] ?? null)).toEqual(['10', '20', '30', '40', null])
    const byNumDesc = await owner.get(`${base()}/responses?sort=${Q.num}&dir=desc`)
    // Unanswered stays last in both directions.
    expect(byNumDesc.body.rows.map((r: { cells: Record<string, string> }) => r.cells[Q.num] ?? null)).toEqual(['40', '30', '20', '10', null])
    const byChoice = await owner.get(`${base()}/responses?sort=${Q.choice}&dir=asc`)
    expect(byChoice.body.rows.map((r: { cells: Record<string, string> }) => r.cells[Q.choice])).toEqual([
      'Apple', 'Apple', 'Blueberry', 'Cherry (deleted option)', 'Durian',
    ])
    const byDuration = await owner.get(`${base()}/responses?sort=duration&dir=asc`)
    expect(byDuration.body.rows.map((r: { id: string }) => r.id)).toEqual(rid)
    const bad = await owner.get(`${base()}/responses?sort=password_hash`)
    expect(bad.status).toBe(422)
  })

  it('searches text answers and filters by choices and dates', async () => {
    const search = await owner.get(`${base()}/responses?q=LOVELACE`)
    expect(search.body.rows.map((r: { id: string }) => r.id)).toEqual([rid[0]])
    const other = await owner.get(`${base()}/responses?q=duri`)
    expect(other.body.total).toBe(1)
    const pct = await owner.get(`${base()}/responses?q=${encodeURIComponent('100%')}`)
    expect(pct.body.total).toBe(0)

    const apple = await owner.get(`${base()}/responses?filter=${Q.choice}:${OPT.a}`)
    expect(apple.body.total).toBe(2)
    const appleOrOther = await owner.get(`${base()}/responses?filter=${Q.choice}:${OPT.a}&filter=${Q.choice}:o_other`)
    expect(appleOrOther.body.total).toBe(3)
    const multiY = await owner.get(`${base()}/responses?filter=${Q.multi}:${OPT.y}`)
    expect(multiY.body.total).toBe(2)
    const both = await owner.get(`${base()}/responses?filter=${Q.multi}:${OPT.y}&filter=${Q.choice}:${OPT.b}`)
    expect(both.body.rows.map((r: { id: string }) => r.id)).toEqual([rid[2]])
    const has = await owner.get(`${base()}/responses?has=${Q.email}`)
    expect(has.body.total).toBe(1)
    const old = await owner.get(`${base()}/responses?from=2020-01-01&to=2020-12-31&tz=UTC`)
    expect(old.body).toMatchObject({ total: 0, formTotal: 5 })
  })

  it('paginates 50 per page with an exact total', async () => {
    const big = await insertBenchForm(sql)
    await insertFakeResponses(sql, big, 120, { days: 10 })
    const p1 = await owner.get(`/api/forms/${big.id}/responses`)
    const p3 = await owner.get(`/api/forms/${big.id}/responses?page=3`)
    expect(p1.body).toMatchObject({ total: 120, pageSize: 50, page: 1 })
    expect(p1.body.rows).toHaveLength(50)
    expect(p3.body.rows).toHaveLength(20)
    const p2 = await owner.get(`/api/forms/${big.id}/responses?page=2`)
    const ids = new Set([...p1.body.rows, ...p2.body.rows, ...p3.body.rows].map((r: { id: string }) => r.id))
    expect(ids.size).toBe(120)
  })
})

// ------------------------------------------------------------------ Drawer

describe('drawer', () => {
  it('shows labels as submitted and keyset neighbours', async () => {
    const res = await owner.get(`${base()}/responses/${rid[0]}`)
    expect(res.status).toBe(200)
    const d = res.body
    expect(d.formVersion).toBe(1)
    const label = (id: string) => d.answers.find((a: { fieldId: string }) => a.fieldId === id)
    expect(label(Q.text)).toMatchObject({ label: 'Old label', text: 'hello, "world"' })
    expect(label(Q.choice).text).toBe('Cherry')
    expect(label(Q.gone)).toMatchObject({ label: 'Removed question', text: 'bye' })
    // Default order is newest first: r0 is last.
    expect(d).toMatchObject({ prevId: rid[1], nextId: null, position: 5, total: 5 })

    const v2 = await owner.get(`${base()}/responses/${rid[2]}`)
    expect(v2.body.answers.find((a: { fieldId: string }) => a.fieldId === Q.text).label).toBe('New label')
    expect(v2.body.answers.some((a: { fieldId: string }) => a.fieldId === Q.gone)).toBe(false)
  })

  it('walks prev / next within a filter and a custom sort', async () => {
    const qs = `sort=${Q.num}&dir=asc`
    const walk: string[] = []
    let id: string | null = rid[0]
    while (id) {
      walk.push(id)
      const r: { body: { nextId: string | null } } = await owner.get(`${base()}/responses/${id}?${qs}`)
      id = r.body.nextId
    }
    expect(walk).toEqual([rid[0], rid[1], rid[2], rid[3], rid[4]])
    const back = await owner.get(`${base()}/responses/${rid[4]}?${qs}`)
    expect(back.body).toMatchObject({ prevId: rid[3], nextId: null, position: 5 })

    const filtered = await owner.get(`${base()}/responses/${rid[4]}?filter=${Q.choice}:${OPT.a}`)
    expect(filtered.body).toMatchObject({ prevId: null, nextId: rid[1], position: 1, total: 2 })
  })

  it('404s for another form’s response', async () => {
    const other = await insertBenchForm(sql)
    const res = await owner.get(`/api/forms/${other.id}/responses/${rid[0]}`)
    expect(res.status).toBe(404)
  })
})

// ------------------------------------------------------------------ CSV

describe('CSV export', () => {
  it('streams a BOM, one column per field and escaped cells', async () => {
    const res = await viewer.get(`${base()}/responses.csv?tz=UTC`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="Fruit survey responses \d{4}-\d{2}-\d{2}\.csv"/)
    // The text decoder drops the BOM, so check the raw bytes.
    const cookie = [...viewer.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    const raw = new Uint8Array(await (await ctx.app.request(`${base()}/responses.csv`, { headers: { cookie } })).arrayBuffer())
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = res.text.replace(/^\uFEFF/, '').split('\r\n')
    expect(lines[0]).toBe(
      'Your name (first name),Your name (last name),Email,Favourite fruit,Toppings,Recommend us?,Rate us,How many?,New label,' +
        'Removed question (deleted),Submitted at,Completion time (seconds),Device,Browser,Country,Response ID',
    )
    expect(res.text).toContain(`Ada,Lovelace,ada@example.com,Cherry,X; Y,10,5,10,"hello, ""world""",bye,`)
    expect(res.text).toContain(`'=SUM(A1)`)
    expect(res.text).toContain('"line1\nline2"')
    expect(res.text).toContain(',Durian,')
    expect(res.text.match(new RegExp(rid[0], 'g'))).toHaveLength(1)
  })

  it('applies the filters, or exports only selected ids', async () => {
    const filtered = await owner.get(`${base()}/responses.csv?filter=${Q.choice}:${OPT.a}`)
    expect(filtered.text.trim().split('\r\n')).toHaveLength(3)
    const selected = await owner.get(`${base()}/responses.csv?ids=${rid[3]}&ids=${rid[4]}`)
    const body = selected.text
    expect(body).toContain(rid[3])
    expect(body).toContain(rid[4])
    expect(body).not.toContain(rid[0])
  })
})

// ------------------------------------------------------------------ Roles, deletes, prefs

describe('roles and deletes', () => {
  it('requires a session', async () => {
    const anon = ctx.client()
    expect((await anon.get(`${base()}/responses`)).status).toBe(401)
    expect((await anon.get(`${base()}/summary`)).status).toBe(401)
  })

  it('a Viewer can read and export but not delete', async () => {
    expect((await viewer.get(`${base()}/summary`)).status).toBe(200)
    expect((await viewer.del(`${base()}/responses/${rid[4]}`)).status).toBe(403)
    expect((await viewer.post(`${base()}/responses/bulk-delete`, { ids: [rid[4]] })).status).toBe(403)
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM responses WHERE form_id = ${formId}`
    expect(n).toBe(5)
  })

  it('delete and bulk delete keep response_count in sync', async () => {
    const count = async () => (await sql`SELECT response_count, last_response_at FROM forms WHERE id = ${formId}`)[0]
    const del = await editor.del(`${base()}/responses/${rid[4]}`)
    expect(del.status).toBe(200)
    expect(del.body).toEqual({ deleted: 1 })
    expect((await count()).response_count).toBe(4)
    expect((await editor.del(`${base()}/responses/${rid[4]}`)).status).toBe(404)

    const bulk = await owner.post(`${base()}/responses/bulk-delete`, { ids: [rid[2], rid[3], rid[4]] })
    expect(bulk.body).toEqual({ deleted: 2 })
    const after = await count()
    expect(after.response_count).toBe(2)
    const [{ last }] = await sql`SELECT max(submitted_at) AS last FROM responses WHERE form_id = ${formId}`
    expect(after.last_response_at.getTime()).toBe(last.getTime())
    expect((await owner.post(`${base()}/responses/bulk-delete`, { ids: [] })).status).toBe(422)
  })

  it('saves column preferences per user', async () => {
    expect((await viewer.get(`${base()}/responses/prefs`)).body).toEqual({ columns: null })
    const cols = [{ id: Q.email, visible: true }, { id: 'submitted_at', visible: false }]
    const put = await viewer.request('PUT', `${base()}/responses/prefs`, { columns: cols })
    expect(put.status).toBe(200)
    expect((await viewer.get(`${base()}/responses/prefs`)).body).toEqual({ columns: cols })
    expect((await owner.get(`${base()}/responses/prefs`)).body).toEqual({ columns: null })
    expect((await viewer.request('PUT', `${base()}/responses/prefs`, { columns: [{ id: 'nope', visible: true }] })).status).toBe(422)
  })

  it('404s for a missing form', async () => {
    expect((await owner.get('/api/forms/00000000-0000-4000-8000-000000000000/summary')).status).toBe(404)
    expect((await owner.get('/api/forms/not-a-uuid/responses')).status).toBe(404)
  })
})
