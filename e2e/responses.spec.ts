import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../playwright.config'
import { F, O, insertBenchForm, insertFakeResponses, insertFunnel } from '../server/responses/fixtures'

/**
 * Responses tab, end to end: a seeded form shows the summary, a bar opens the table filtered
 * to that option, the drawer walks responses by keyboard, and the CSV downloads with a BOM.
 * The form and its responses are inserted straight into the e2e database.
 */
// Same Owner as e2e/platform.spec.ts (importing a spec file would register its tests twice).
const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }
const COUNT = 60
// Local runs while the builder page is mid-edit can point at Agent G's scratch harness instead.
const tabUrl = (formId: string) =>
  process.env.E2E_RESPONSES_HARNESS ? `/test-results/g-responses/harness.html?form=${formId}` : `/dashboard/forms/${formId}/responses`

test('summary, filtered table, keyboard drawer and CSV export', async ({ page }) => {
  const { needsSetup } = await (await page.request.get('/api/setup')).json()
  if (needsSetup) {
    await page.goto('/setup')
    await page.getByLabel('Your name').fill(OWNER.name)
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByLabel('App name').fill(OWNER.appName)
    await page.getByRole('button', { name: /create|set up|continue/i }).click()
  } else {
    await page.goto('/login')
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByRole('button', { name: 'Log in' }).click()
  }
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} })
  let formId: string
  let proCount: number
  try {
    const form = await insertBenchForm(sql as never, undefined, `Responses e2e ${Date.now()}`)
    await insertFakeResponses(sql as never, form, COUNT, { days: 20 })
    await insertFunnel(sql as never, form.id, 150, 90)
    formId = form.id
    ;[{ n: proCount }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM responses WHERE form_id = ${form.id} AND answers @> ${sql.json({ [F.plan]: { option: O.pro } })}
    `
  } finally {
    await sql.end()
  }

  // Summary (the default view).
  await page.goto(tabUrl(formId))
  await expect(page.getByRole('heading', { name: 'Views → Starts → Responses' })).toBeVisible()
  await expect(page.locator('[data-slot="stat-card"]').filter({ hasText: 'Responses' }).first()).toContainText(String(COUNT))
  const plan = page.getByTestId(`summary-${F.plan}`)
  await expect(plan).toContainText('Which plan are you on?')

  // A bar opens the table filtered to that option.
  await plan.getByRole('button', { name: /^Pro: / }).click()
  await expect(page).toHaveURL(/view=table/)
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Which plan are you on?: Pro')
  const pagination = page.getByRole('navigation', { name: 'Pagination' })
  await expect(pagination).toContainText(`of ${proCount}`)

  // Drawer by keyboard: J / → next, K / ← previous, Escape closes.
  await page.getByRole('button', { name: /^Open response from/ }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText(`1 of ${proCount}`)
  await expect(drawer.getByText('Which plan are you on?')).toBeVisible()
  await page.keyboard.press('j')
  await expect(drawer).toContainText(`2 of ${proCount}`)
  await page.keyboard.press('ArrowRight')
  await expect(drawer).toContainText(`3 of ${proCount}`)
  await page.keyboard.press('k')
  await expect(drawer).toContainText(`2 of ${proCount}`)
  await expect(page).toHaveURL(/response=[0-9a-f-]{36}/)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(page).not.toHaveURL(/response=/)

  // CSV of the current filter, with a BOM.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()])
  expect(download.suggestedFilename()).toMatch(/responses \d{4}-\d{2}-\d{2}\.csv$/)
  const bytes = await readFile((await download.path())!)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = bytes.toString('utf8').slice(1).trim().split('\r\n')
  expect(lines[0]).toContain('Your name (first name),Your name (last name),Work email')
  expect(lines).toHaveLength(proCount + 1)
})
