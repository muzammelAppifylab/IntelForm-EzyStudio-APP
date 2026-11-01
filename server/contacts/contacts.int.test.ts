import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { JSONValue } from 'postgres'

/**
 * Integration tests for the Contacts API on a fresh, migrated database (server/test/harness.ts).
 * Locally the base is intelform_contacts; CI sets TEST_DATABASE_URL.
 */
process.env.TEST_DATABASE_URL ??= 'postgres://intelform:intelform@localhost:5433/intelform_contacts'
process.env.TEST_APP_URL ??= 'http://localhost:5195'

const { setupTestDb, setupOwner, addMember } = await import('../test/harness')
const ctx = await setupTestDb()
const { sql } = ctx

type Client = Awaited<ReturnType<typeof setupOwner>>
let owner: Client
let viewer: Client

const F = { name: 'f_name0001', email: 'f_email001', phone: 'f_phone001', text: 'f_text0001' }

const fields = (types: ('name' | 'email' | 'phone')[]) => [
  ...types.map((t) => ({ id: F[t], type: t, label: t, required: false, props: t === 'name' ? { split: true } : {} })),
  { id: F.text, type: 'short_text', label: 'Anything else?', required: false, props: {} },
]

async function form(title: string, types: ('name' | 'email' | 'phone')[]) {
  const def = { layout: 'all_at_once', startScreen: { enabled: false }, endScreen: { title: 'Thanks' }, fields: fields(types) }
  const slug = title.toLowerCase().replace(/\W+/g, '-')
  const [f] = await sql<{ id: string }[]>`
    INSERT INTO forms (slug, title, status, draft) VALUES (${slug}, ${title}, 'live', ${sql.json(def as JSONValue)}) RETURNING id
  `
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${f.id}, 1, ${sql.json(def as JSONValue)}, '{}') RETURNING id
  `
  await sql`UPDATE forms SET published_version_id = ${v.id} WHERE id = ${f.id}`
  return { id: f.id, versionId: v.id }
}

async function respond(fm: { id: string; versionId: string }, answers: Record<string, unknown>, hoursAgo: number, country = 'GB') {
  await sql`
    INSERT INTO responses (form_id, form_version_id, answers, submitted_at, device, country)
    VALUES (${fm.id}, ${fm.versionId}, ${sql.json(answers as JSONValue)}, now() - ${`${hoursAgo} hours`}::interval, 'desktop', ${country})
  `
  await sql`
    UPDATE forms SET response_count = (SELECT count(*) FROM responses WHERE form_id = ${fm.id}),
      last_response_at = (SELECT max(submitted_at) FROM responses WHERE form_id = ${fm.id}) WHERE id = ${fm.id}
  `
}

let survey: { id: string; versionId: string }
let signup: { id: string; versionId: string }

beforeAll(async () => {
  owner = await setupOwner(ctx)
  viewer = await addMember(ctx, owner, 'viewer')
  survey = await form('Customer survey', ['name', 'email'])
  signup = await form('Event signup', ['email', 'phone'])
  const callback = await form('Callback request', ['phone'])
  // Ada answers both forms (the second time with stray spaces and capitals in her email).
  await respond(survey, { [F.name]: { first: 'Ada', last: 'Lovelace' }, [F.email]: 'ada@example.com' }, 400, 'GB')
  await respond(signup, { [F.email]: '  ADA@Example.com ', [F.phone]: '+44 7700 900111' }, 2, 'FR')
  await respond(survey, { [F.name]: { first: 'Grace', last: '' }, [F.email]: 'grace@example.com' }, 30, 'US')
  // Phone only, then no contact details at all.
  await respond(callback, { [F.phone]: '+15555550123' }, 5, 'US')
  await respond(survey, { [F.text]: 'anonymous' }, 1)
}, 60_000)

afterAll(async () => {
  await ctx.teardown()
})

describe('contacts', () => {
  it('groups by email across forms and keeps phone-only contacts', async () => {
    const res = await viewer.get('/api/contacts')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(3)
    const keys = res.body.contacts.map((c: { key: string }) => c.key)
    // Newest activity first.
    expect(keys).toEqual(['e:ada@example.com', 'p:+15555550123', 'e:grace@example.com'])
    const ada = res.body.contacts[0]
    expect(ada).toMatchObject({ name: 'Ada Lovelace', phone: '+447700900111', country: 'FR', responseCount: 2, formCount: 2 })
    expect(ada.forms.map((f: { title: string }) => f.title)).toEqual(['Event signup', 'Customer survey'])
    expect(res.body.contacts[1]).toMatchObject({ email: null, phone: '+15555550123', name: null })
    expect(res.body.contacts[2].name).toBe('Grace')
    const overview = (await viewer.get('/api/contacts/overview')).body
    expect(overview.strip).toMatchObject({ total: 3, returning: 1, newThisWeek: 2, withPhonePct: 67 })
    expect(overview.facets.forms[0]).toMatchObject({ title: 'Customer survey', contacts: 2, status: 'live' })
    expect(overview.facets.countries).toEqual([
      { code: 'US', contacts: 2 },
      { code: 'FR', contacts: 1 },
    ])
  })

  it('filters and sorts', async () => {
    const keys = async (qs: string) => {
      const res = await owner.get(`/api/contacts?${qs}`)
      expect(res.status).toBe(200)
      return res.body.contacts.map((c: { key: string }) => c.key)
    }
    expect(await keys(`form=${signup.id}`)).toEqual(['e:ada@example.com'])
    expect(await keys('has=phone&has=email')).toEqual(['e:ada@example.com'])
    expect(await keys('q=LOVE')).toEqual(['e:ada@example.com'])
    expect(await keys('q=555 555')).toEqual(['p:+15555550123'])
    expect(await keys('segment=returning')).toEqual(['e:ada@example.com'])
    expect(await keys('country=US&min=1&max=1')).toEqual(['p:+15555550123', 'e:grace@example.com'])
    expect(await keys('sort=name&dir=asc')).toEqual(['e:ada@example.com', 'e:grace@example.com', 'p:+15555550123'])
    expect(await keys('sort=responses&dir=desc')).toEqual(['e:ada@example.com', 'p:+15555550123', 'e:grace@example.com'])
    expect((await owner.get('/api/contacts?min=3&max=2')).status).toBe(422)
  })

  it('shows one contact, and 404s for unknown keys', async () => {
    const res = await viewer.get('/api/contacts/detail?key=e:ada@example.com')
    expect(res.status).toBe(200)
    expect(res.body.responses).toHaveLength(2)
    expect(res.body.responses[0].form.title).toBe('Event signup')
    expect(res.body.forms.map((f: { responses: number }) => f.responses)).toEqual([1, 1])
    expect((await viewer.get('/api/contacts/detail?key=e:nobody@example.com')).status).toBe(404)
    expect((await viewer.get('/api/contacts/detail?key=bogus')).status).toBe(404)
  })

  it('exports CSV', async () => {
    const res = await viewer.get('/api/contacts/export.csv?key=e:ada@example.com&tz=UTC')
    expect(res.status).toBe(200)
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('Name,Email,Phone,Country,Responses,Forms,First seen,Last active')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/^Ada Lovelace,ada@example\.com,'\+447700900111,FR,2,Event signup; Customer survey,/)
  })

  it('deletes every response of a contact; viewers cannot', async () => {
    expect((await viewer.post('/api/contacts/delete', { keys: ['e:ada@example.com'] })).status).toBe(403)
    const res = await owner.post('/api/contacts/delete', { keys: ['e:ada@example.com', 'e:nobody@example.com'] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ contacts: 1, responses: 2 })
    const counts = await sql<{ id: string; response_count: number }[]>`SELECT id, response_count FROM forms WHERE id IN (${survey.id}, ${signup.id})`
    expect(Object.fromEntries(counts.map((c) => [c.id, c.response_count]))).toEqual({ [survey.id]: 2, [signup.id]: 0 })
    expect((await owner.get('/api/contacts')).body.total).toBe(2)
  })
})
