import { TEST_ORIGIN } from './env'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import type { Me } from '../../shared/api'

/**
 * Integration-test harness (docs/research/06-security-quality.md B4).
 *
 * - A template database `<base>_tpl` (intelform_c_tpl locally) is migrated once and rebuilt
 *   only when a migration file changes (fingerprint kept in the database comment).
 * - Each test file gets its own fresh database: CREATE DATABASE … TEMPLATE <base>_tpl.
 * - `client()` returns an `app.request()` wrapper with a cookie jar, the Origin header, and
 *   its own fake client IP (so per-IP rate limits don't leak between "users").
 *
 * Base URL: TEST_DATABASE_URL, default postgres://intelform:intelform@localhost:5433/intelform_c
 */

const BASE_URL = process.env.TEST_DATABASE_URL || 'postgres://intelform:intelform@localhost:5433/intelform_c'
const MIGRATIONS = fileURLToPath(new URL('../db/migrations/', import.meta.url))

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

const baseName = new URL(BASE_URL).pathname.slice(1) || 'intelform'
const TEMPLATE = `${baseName}_tpl`
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

async function fingerprint(): Promise<string> {
  const h = createHash('sha256')
  for (const f of (await readdir(MIGRATIONS)).filter((x) => x.endsWith('.sql')).sort()) {
    h.update(f).update(await readFile(join(MIGRATIONS, f)))
  }
  return h.digest('hex').slice(0, 32)
}

type AppModule = typeof import('../app')
type DbModule = typeof import('../db/client')

export interface TestContext {
  app: AppModule['app']
  sql: DbModule['sql']
  dbName: string
  client: (ip?: string) => TestClient
  teardown: () => Promise<void>
}

/**
 * Creates this file's database and imports the app against it. Call in `beforeAll`, and
 * `teardown()` in `afterAll`. Extra env (e.g. UPLOADS_DIR) can be passed before the import.
 */
export async function setupTestDb(extraEnv: Record<string, string> = {}): Promise<TestContext> {
  const admin = postgres(withDb(BASE_URL, 'postgres'), { max: 1, onnotice: () => {} })
  const dbName = `${baseName}_t_${randomBytes(5).toString('hex')}`
  const fp = await fingerprint()
  // Set before the first import of server/env.ts (the migrate import below), which reads it once.
  process.env.DATABASE_URL = withDb(BASE_URL, dbName)
  process.env.UPLOADS_DIR ||= await mkdtemp(join(tmpdir(), 'intelform-uploads-'))
  Object.assign(process.env, extraEnv)
  try {
    await admin`SELECT pg_advisory_lock(hashtext(${TEMPLATE}))`
    const [row] = await admin<{ comment: string | null }[]>`
      SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = ${TEMPLATE}
    `
    if (row?.comment !== fp) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${ident(TEMPLATE)} WITH (FORCE)`)
      await admin.unsafe(`CREATE DATABASE ${ident(TEMPLATE)}`)
      const tpl = postgres(withDb(BASE_URL, TEMPLATE), { max: 1, onnotice: () => {} })
      try {
        const { runMigrations } = await import('../db/migrate')
        await runMigrations(tpl as never, () => {})
      } finally {
        await tpl.end({ timeout: 5 })
      }
      await admin.unsafe(`COMMENT ON DATABASE ${ident(TEMPLATE)} IS '${fp}'`)
    }
    await admin.unsafe(`CREATE DATABASE ${ident(dbName)} TEMPLATE ${ident(TEMPLATE)}`)
  } finally {
    await admin`SELECT pg_advisory_unlock(hashtext(${TEMPLATE}))`.catch(() => {})
  }

  const { app } = await import('../app')
  const { sql } = await import('../db/client')

  return {
    app,
    sql,
    dbName,
    client: (ip) => new TestClient(app, ip),
    async teardown() {
      await sql.end({ timeout: 5 })
      await admin.unsafe(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`).catch(() => {})
      await admin.end({ timeout: 5 })
    },
  }
}

export interface TestResponse<T = any> {
  status: number
  body: T
  text: string
  headers: Headers
}

export interface RequestOptions {
  headers?: Record<string, string>
  /** Origin header; defaults to APP_URL's origin. `null` sends none. */
  origin?: string | null
  /** Raw body (FormData, string); otherwise `body` is sent as JSON. */
  raw?: BodyInit
}

let ipCounter = 0
/** A distinct public-looking IP per client (TEST-NET-3 range is fine: it's never dialled). */
function nextIp(): string {
  ipCounter++
  return `203.0.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

/** `app.request()` with a cookie jar, the Origin header and a fake socket address. */
export class TestClient {
  readonly cookies = new Map<string, string>()
  readonly ip: string
  me: Me | null = null
  private readonly app: AppModule['app']

  constructor(app: AppModule['app'], ip?: string) {
    this.app = app
    this.ip = ip ?? nextIp()
  }

  async request<T = any>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<TestResponse<T>> {
    const headers = new Headers(opts.headers)
    const origin = opts.origin === undefined ? TEST_ORIGIN : opts.origin
    if (origin) headers.set('origin', origin)
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    let payload: BodyInit | undefined = opts.raw
    if (payload === undefined && body !== undefined) {
      payload = JSON.stringify(body)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    }
    const res = await this.app.request(path, { method, headers, body: payload }, { incoming: { socket: { remoteAddress: this.ip, remoteFamily: 'IPv4' } } })
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      const expired = attrs.some((a) => /max-age=0/i.test(a) || (/expires=/i.test(a) && new Date(a.split('=')[1]).getTime() < Date.now()))
      if (!value || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    const text = await res.text()
    let parsed: unknown = text
    if (res.headers.get('content-type')?.includes('application/json') && text) parsed = JSON.parse(text)
    return { status: res.status, body: parsed as T, text, headers: res.headers }
  }

  get<T = any>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, undefined, opts)
  }
  post<T = any>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, body, opts)
  }
  patch<T = any>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, body, opts)
  }
  del<T = any>(path: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, undefined, opts)
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Test Forms' }

/** Runs first-run setup and returns the signed-in Owner client. */
export async function setupOwner(ctx: TestContext): Promise<TestClient> {
  const owner = ctx.client()
  const res = await owner.post('/api/setup', OWNER)
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${res.text}`)
  owner.me = res.body
  return owner
}

let memberCounter = 0
/** Invites and accepts a new member with `role`; returns their signed-in client. */
export async function addMember(ctx: TestContext, owner: TestClient, role: 'editor' | 'viewer', name = `Member ${++memberCounter}`): Promise<TestClient> {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${randomBytes(3).toString('hex')}@example.com`
  const inv = await owner.post('/api/invites', { email, role })
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${inv.text}`)
  const token = inv.body.link.split('/invite/')[1]
  const member = ctx.client()
  const acc = await member.post(`/api/invites/${token}/accept`, { name, password: 'member-password-1' })
  if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${acc.text}`)
  member.me = acc.body
  return member
}

/** Inserts a minimal form (and a published version) straight into the database. */
export async function insertForm(sql: TestContext['sql'], opts: { settings?: object; status?: string; slug?: string } = {}) {
  const slug = opts.slug ?? `form-${randomBytes(4).toString('hex')}`
  const [form] = await sql<{ id: string }[]>`
    INSERT INTO forms (slug, title, status, draft, settings)
    VALUES (${slug}, ${'Form ' + slug}, ${opts.status ?? 'live'}, ${sql.json({ fields: [] })}, ${sql.json((opts.settings ?? {}) as never)})
    RETURNING id
  `
  const [version] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${form.id}, 1, ${sql.json({ fields: [] })}, ${sql.json({})})
    RETURNING id
  `
  await sql`UPDATE forms SET published_version_id = ${version.id} WHERE id = ${form.id}`
  return { id: form.id, versionId: version.id, slug }
}
