import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { app as api } from './app'
import { sql } from './db/client'
import { runMigrations } from './db/migrate'
import { seedBuiltinTemplates } from './db/seed'
import { env, isProduction } from './env'
import { ApiError, errorResponse } from './lib/errors'
import { startJobs, stopJobs } from './lib/jobs'
import { logger } from './lib/logger'
import { startScheduler, stopScheduler } from './lib/scheduler'
import { decodeUploadPath, readLocalFile } from './lib/uploads'
import { renderFormPage } from './respondent/inline'
import { renderHomePage } from './routes/front-page'
import { publicPageRateLimit } from './routes/public-forms'
import { inlineScriptHashes, surfaceFor, surfaceHeaders } from './middleware/security-headers'

/**
 * Local and self-hosted entry point. In development Vite serves the React app and proxies
 * /api here. In production this also serves the built app from dist/ with an SPA fallback,
 * with security headers per surface (dashboard, public form, API).
 */
if (env.MIGRATE_ON_BOOT) await runMigrations(sql, (line) => logger.info(line))
// Built-in templates ship as seed data; the upsert only writes rows whose content changed.
try {
  const { written, deleted } = await seedBuiltinTemplates(sql)
  if (written || deleted) logger.info({ written, deleted }, 'built-in templates updated')
} catch (err) {
  logger.warn({ err }, 'built-in templates not seeded (run npm run db:migrate)')
}

const server = new Hono()

// HTML surfaces. The API sets its own headers in app.ts.
interface Shell {
  html: string
  hashes: string[]
}
let appShell: Shell | null = null
let formShell: Shell | null = null
if (isProduction) {
  const html = await readFile('dist/index.html', 'utf8')
  appShell = { html, hashes: inlineScriptHashes(html) }
  // A separate respondent entry (form.html) is used when the build has one.
  if (existsSync('dist/form.html')) {
    const f = await readFile('dist/form.html', 'utf8')
    formShell = { html: f, hashes: inlineScriptHashes(f) }
  }
}
const hashesFor = (path: string) => (surfaceFor(path) === 'form' ? (formShell ?? appShell)?.hashes : appShell?.hashes) ?? []

server.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next()
  return surfaceHeaders(surfaceFor, hashesFor)(c, next)
})

server.route('/', api)
// A mounted app's notFound handler doesn't apply to the parent, so unknown API paths are caught here.
server.all('/api/*', (c) => errorResponse(c, new ApiError(404, 'not_found', 'No such API route')))

// Local-disk uploads (no Bunny configured) are also reachable at /uploads/*.
server.get('/uploads/*', async (c) => {
  const rel = decodeUploadPath(c.req.path.slice('/uploads/'.length))
  const file = rel === null ? null : await readLocalFile(rel)
  if (!file) return c.text('Not found', 404)
  return c.body(new Uint8Array(file.buf), 200, {
    'Content-Type': file.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  })
})

if (isProduction && appShell) {
  const shell = appShell
  // Only the front page, legal pages and forms may be indexed (forms decide per form later).
  const indexable = (path: string) => path === '/' || path === '/privacy' || path === '/terms' || path.startsWith('/f/')

  const sendShell = (c: Context) => {
    if (!indexable(c.req.path)) c.header('X-Robots-Tag', 'noindex')
    // The HTML names the current hashed bundles: always revalidate it (A6).
    c.header('Cache-Control', 'no-cache')
    const s = surfaceFor(c.req.path) === 'form' && formShell ? formShell : shell
    return c.html(s.html)
  }

  // The front page: its SEO tags in the HTML itself, for crawlers and link previews.
  server.get('/', async (c) => {
    const page = await renderHomePage(shell.html, env.APP_URL).catch(() => null)
    if (!page) return sendShell(c)
    c.header('Cache-Control', 'no-cache')
    if (page.noindex) c.header('X-Robots-Tag', 'noindex')
    return c.html(page.html)
  })
  server.get('/index.html', sendShell)
  server.get('/form.html', (c) => c.text('Not found', 404))

  // Vite's hashed files never change, so browsers may keep them for a year.
  server.use('/assets/*', async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
  })
  // The embed loader is not hashed: short cache so updates reach sites within minutes.
  server.use('/embed.js', async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=300')
  })
  // Public forms: the respondent shell with the form JSON inlined, so the first paint needs no extra request.
  // Rate limited per IP, sharing one budget with the JSON definition (/api/public/forms/:slug).
  server.get('/f/:slug', publicPageRateLimit, async (c) => {
    if (!formShell) return sendShell(c)
    const page = await renderFormPage(formShell.html, c.req.param('slug'))
    c.header('Cache-Control', 'no-cache')
    if (page.noindex) c.header('X-Robots-Tag', 'noindex')
    return c.html(page.html, page.status)
  })
  server.use('*', serveStatic({ root: './dist' }))
  // A missing file is a 404, not the app: a stale chunk must fail loudly, not parse HTML as JS.
  server.get('/assets/*', (c) => c.text('Not found', 404))
  server.get('*', (c) => {
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.text('Not found', 404)
    return sendShell(c)
  })
}

const httpServer = serve({ fetch: server.fetch, port: env.API_PORT }, (info) => {
  logger.info(`IntelForm listening on http://localhost:${info.port}`)
})

await startJobs()
startScheduler()

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  logger.info({ signal }, 'shutting down')
  const force = setTimeout(() => process.exit(1), 20_000)
  force.unref()
  // Stop accepting connections, finish timers and running jobs, then close the pool.
  httpServer.close()
  await stopScheduler()
  await stopJobs(10_000)
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
