import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Public site and App settings, end to end. In the full suite the platform spec has already run
 * setup, so this logs in as its Owner; on a fresh install it runs setup itself.
 */
// Same Owner as e2e/platform.spec.ts (importing a spec file would register its tests twice).
const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }

test.describe.configure({ mode: 'serial' })

async function logIn(page: Page) {
  const { needsSetup } = await (await page.request.get('/api/setup')).json()
  if (needsSetup) {
    await page.goto('/setup')
    await page.getByLabel('Your name').fill(OWNER.name)
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByLabel('App name').fill(OWNER.appName)
    await page.getByRole('button', { name: 'Create Owner account' }).click()
  } else {
    await page.goto('/login')
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByRole('button', { name: 'Log in' }).click()
  }
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('a listed form shows on the public site until it closes; privacy text comes from Settings', async ({ page, browser, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await logIn(page)

  // A Live form, listed on the homepage (the Share tab's toggle), made through the forms API.
  const title = `Waitlist ${Date.now().toString(36)}`
  const created = await page.request.post('/api/forms', { headers: { origin }, data: { templateSlug: 'builtin-waitlist', title } })
  expect(created.status()).toBe(201)
  const form = (await created.json()) as { id: string; slug: string }
  const listed = await page.request.patch(`/api/forms/${form.id}`, { headers: { origin }, data: { settings: { showOnFrontPage: true, frontPageDescription: 'Join the list in a minute.' } } })
  expect(listed.status()).toBe(200)
  expect((await page.request.post(`/api/forms/${form.id}/publish`, { headers: { origin }, data: {} })).status()).toBe(200)

  // Settings → Public site: the privacy policy.
  await page.goto('/dashboard/settings?tab=site')
  await page.getByLabel('Privacy policy').fill('We keep only what you send us.\n\nAsk us to delete it any time.')
  await page.getByRole('button', { name: 'Save' }).last().click()
  await expect(page.getByText('Privacy and terms saved')).toBeVisible()

  // A visitor (no session) sees the home page with the card.
  const visitorContext = await browser.newContext({ baseURL })
  const visitor = await visitorContext.newPage()
  await visitor.goto('/')
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible()
  const card = visitor.getByRole('article').filter({ hasText: title })
  await expect(card).toContainText('Join the list in a minute.')
  await expect(card.getByRole('link', { name: `Open ${title}` })).toHaveAttribute('href', `/f/${form.slug}`)
  await expect(visitor.getByRole('link', { name: 'Team login' })).toBeVisible()
  await expect(visitor.locator('body')).not.toContainText(/sign up|pricing|intelform/i)
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  await axe(visitor)

  await visitor.getByRole('banner').getByRole('link', { name: 'About', exact: true }).click()
  await expect(visitor).toHaveURL(/\/about$/)
  await expect(visitor.getByRole('heading', { level: 1, name: /^About / })).toBeVisible()
  await axe(visitor)

  await visitor.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click()
  await expect(visitor).toHaveURL(/\/privacy$/)
  await expect(visitor.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible()
  await expect(visitor.getByText('Ask us to delete it any time.')).toBeVisible()

  // Closing the form removes its card.
  expect((await page.request.post(`/api/forms/${form.id}/close`, { headers: { origin }, data: {} })).status()).toBe(200)
  await visitor.goto('/')
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(visitor.getByRole('article').filter({ hasText: title })).toHaveCount(0)
  await visitorContext.close()
})

test('app name shows on the login page; Turnstile secrets are never echoed', async ({ page, browser, baseURL }) => {
  await logIn(page)
  const before = (await (await page.request.get('/api/public/app')).json()).appName as string

  // General: rename the app.
  await page.goto('/dashboard/settings')
  const name = page.getByLabel('App name')
  await name.fill('Harbor clinic forms')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('General settings saved')).toBeVisible()
  const visitorContext = await browser.newContext({ baseURL })
  const visitor = await visitorContext.newPage()
  await visitor.goto('/login')
  await expect(visitor.getByText('Harbor clinic forms').first()).toBeVisible()
  await visitorContext.close()

  // Spam protection: Cloudflare's always-pass test keys.
  const secret = '1x0000000000000000000000000000000AA'
  await page.goto('/dashboard/settings?tab=spam')
  await page.getByLabel('Site key').fill('1x00000000000000000000AA')
  await page.getByLabel('Secret key').fill(secret)
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(await (await saved).text()).not.toContain(secret)
  await expect(page.getByText('Spam protection saved')).toBeVisible()
  await expect(page.getByLabel('Secret key')).toHaveValue('')
  await expect(page.getByText('Set', { exact: true })).toBeVisible()

  const view = await page.request.get('/api/settings')
  const body = await view.text()
  expect(body).not.toContain(secret)
  expect(JSON.parse(body).spam).toEqual({ turnstileSiteKey: '1x00000000000000000000AA', turnstileSecret: { set: true } })
  await page.reload()
  expect(await page.content()).not.toContain(secret)

  // Leave the install as it was: other specs submit forms without Turnstile.
  await page.getByRole('button', { name: 'Remove secret key' }).click()
  await page.getByLabel('Site key').fill('')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Spam protection saved')).toBeVisible()
  await expect(page.getByText('Not set', { exact: true })).toBeVisible()
  await page.goto('/dashboard/settings')
  await page.getByLabel('App name').fill(before)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('General settings saved')).toBeVisible()
})
