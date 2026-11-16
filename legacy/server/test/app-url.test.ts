import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// Child processes: server/env.ts validates once per process. env-probe never touches the database.
const run = promisify(execFile)
const probe = fileURLToPath(new URL('./env-probe.ts', import.meta.url))
const base = { ...process.env, NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none', LOG_LEVEL: 'silent' }
const start = (env: Record<string, string>) => run(process.execPath, ['--import', 'tsx', probe], { env: { ...base, ALLOW_HTTP_APP_URL: '', ...env } })

describe('APP_URL in production', () => {
  it('refuses http on a public host unless ALLOW_HTTP_APP_URL=1; loopback http is allowed (e2e)', async () => {
    await expect(start({ APP_URL: 'http://forms.example.com' })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('APP_URL must be https in production') })

    const allowed = await start({ APP_URL: 'http://forms.example.com', ALLOW_HTTP_APP_URL: '1' })
    expect(JSON.parse(allowed.stdout)).toMatchObject({ isHttps: false, appOrigin: 'http://forms.example.com' })

    const local = await start({ APP_URL: 'http://localhost:8793' })
    expect(JSON.parse(local.stdout)).toMatchObject({ isHttps: false, appOrigin: 'http://localhost:8793' })
  }, 60_000)
})
