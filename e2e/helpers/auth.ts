import { expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * Shared e2e identities. The platform spec performs first-run setup with this Owner; the
 * `auth` setup project (auth.setup.ts) then saves a signed-in session to OWNER_STATE, which
 * specs reuse with `test.use({ storageState: OWNER_STATE })` instead of logging in again.
 */
export const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }

export const OWNER_STATE = fileURLToPath(new URL('../../test-results/.auth/owner.json', import.meta.url))

/** The Origin header the CSRF check expects on API writes made with `request`. */
export const originOf = (baseURL: string | undefined) => new URL(baseURL ?? 'http://localhost').origin

/** Signs `request` in as the Owner, running first-run setup if the database is fresh. */
export async function signInOwner(request: APIRequestContext, baseURL: string | undefined): Promise<void> {
  const headers = { origin: originOf(baseURL) }
  const { needsSetup } = (await (await request.get('/api/setup')).json()) as { needsSetup: boolean }
  const res = needsSetup
    ? await request.post('/api/setup', { headers, data: OWNER })
    : await request.post('/api/auth/login', { headers, data: { email: OWNER.email, password: OWNER.password } })
  expect(res.ok(), `owner sign-in: ${res.status()} ${await res.text()}`).toBe(true)
}

/**
 * Invites a member as the signed-in `owner` and accepts the invite in a new browser context
 * through the UI. Returns the member's context (signed in) and email.
 */
export async function inviteAndAccept(
  owner: APIRequestContext,
  browser: Browser,
  baseURL: string | undefined,
  role: 'editor' | 'viewer',
  name: string,
): Promise<{ context: BrowserContext; email: string; password: string }> {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now().toString(36)}@example.com`
  const password = `${role}-password-1`
  const res = await owner.post('/api/invites', { headers: { origin: originOf(baseURL) }, data: { email, role } })
  expect(res.status(), await res.text()).toBe(201)
  const { link } = (await res.json()) as { link: string }
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto(new URL(link).pathname)
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Join the team' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.close()
  return { context, email, password }
}
