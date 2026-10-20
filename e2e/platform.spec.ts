import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Platform, end to end, on the built server (see playwright.config.ts): first-run setup →
 * invite → accept → role checks → logout, the CSP not breaking the app, and axe on /login.
 * Runs first on a fresh database; the Owner it creates is reused by later specs.
 */
export const E2E_OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }

test.describe.configure({ mode: 'serial' })

/** Fails the test on any CSP violation the page reports. */
function watchCsp(page: Page) {
  const violations: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text())
  })
  return violations
}

test('setup → invite → accept → roles → logout', async ({ page, browser }) => {
  const csp = watchCsp(page)

  // First-run setup.
  await page.goto('/setup')
  await page.getByLabel('Your name').fill(E2E_OWNER.name)
  await page.getByLabel('Email').fill(E2E_OWNER.email)
  await page.getByLabel('Password').fill(E2E_OWNER.password)
  await page.getByLabel('App name').fill(E2E_OWNER.appName)
  await page.getByRole('button', { name: 'Create Owner account' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const nav = page.getByRole('navigation').or(page.locator('[data-sidebar="sidebar"]')).first()
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible()

  // The Owner invites an Editor and a Viewer (the API returns the link; email goes to the log).
  const links: Record<string, string> = {}
  for (const role of ['editor', 'viewer'] as const) {
    const res = await page.request.post('/api/invites', { data: { email: `${role}@example.com`, role } })
    expect(res.status()).toBe(201)
    links[role] = (await res.json()).link
  }

  // Each accepts in their own browser and lands on the dashboard.
  for (const role of ['editor', 'viewer'] as const) {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const pCsp = watchCsp(p)
    await p.goto(new URL(links[role]).pathname)
    await expect(p.getByRole('heading', { name: `Join ${E2E_OWNER.appName}` })).toBeVisible()
    await p.getByLabel('Your name').fill(role === 'editor' ? 'Eddie Editor' : 'Vera Viewer')
    await p.getByLabel('Password').fill(`${role}-password-1`)
    await p.getByRole('button', { name: 'Join the team' }).click()
    await expect(p).toHaveURL(/\/dashboard$/)

    // Role checks: no Settings link, and the API refuses.
    await expect(p.getByRole('link', { name: 'Team' })).toBeVisible()
    await expect(p.getByRole('link', { name: 'Settings' })).toHaveCount(0)
    expect((await p.request.get('/api/settings')).status()).toBe(403)
    expect((await p.request.post('/api/invites', { data: { email: 'x@example.com', role: 'viewer' } })).status()).toBe(403)
    // Multipart is a "simple" request, so the CSRF check needs the Origin a browser would send.
    const upload = await p.request.post('/api/uploads?purpose=image', {
      headers: { origin: new URL(p.url()).origin },
      multipart: { file: { name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') } },
    })
    expect(upload.status()).toBe(role === 'editor' ? 201 : 403)
    expect(pCsp).toEqual([])
    await ctx.close()
  }

  // The invite link is single-use.
  const reused = await browser.newContext()
  const rp = await reused.newPage()
  await rp.goto(new URL(links.editor).pathname)
  await expect(rp.getByRole('heading', { name: 'This invite can’t be used' })).toBeVisible()
  await reused.close()

  // The Owner sees both on the Team page.
  await page.goto('/dashboard/team')
  await expect(page.getByText('Eddie Editor')).toBeVisible()
  await expect(page.getByText('Vera Viewer')).toBeVisible()
  expect((await page.request.get('/api/settings')).status()).toBe(200)

  // Log out from the user menu.
  await page.getByRole('button', { name: new RegExp(E2E_OWNER.name) }).first().click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)
  expect((await page.request.get('/api/me')).status()).toBe(401)

  // And back in.
  await page.getByLabel('Email').fill(E2E_OWNER.email)
  await page.getByLabel('Password').fill(E2E_OWNER.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  expect(csp).toEqual([])
})

test('security headers per surface', async ({ request }) => {
  const login = await request.get('/login')
  expect(login.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(login.headers()['content-security-policy']).toMatch(/script-src 'self' 'sha256-[^']+'/)
  expect(login.headers()['x-frame-options']).toBe('DENY')
  expect(login.headers()['cache-control']).toBe('no-cache')

  const form = await request.get('/f/any-form')
  expect(form.headers()['content-security-policy']).toContain('frame-ancestors *')
  expect(form.headers()['content-security-policy']).toContain('https://challenges.cloudflare.com')
  expect(form.headers()['x-frame-options']).toBeUndefined()

  const api = await request.get('/api/health')
  expect(api.headers()['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
})

test('login page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})
