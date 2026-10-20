import { expect, test } from '@playwright/test'
import { OWNER_STATE } from './helpers/auth'
import { liveDefinition, stamp } from './helpers/forms'
import { expectEndScreen, fillByKeyboard } from './helpers/keyboard'

/**
 * The short happy path, on the production build: (setup is done by the platform + auth
 * projects) → create a form from the Survey template in the dashboard → publish it in the
 * builder → a respondent submits it once at /f/:slug, in the template's own layout (one at a
 * time), keyboard only → the response appears in the Responses table.
 *
 * Out of scope here (manual checks, see the CI notes): the three-layout loop, Editor and Viewer
 * roles, CSV, axe on /f/*, embed.js inline and popup.
 */
test.use({ storageState: OWNER_STATE })

test('create from template → publish → submit → response in the table', async ({ page, browser }) => {
  const title = `Journey survey ${stamp()}`

  // Create from the Survey template; lands in the builder.
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'New form' }).click()
  await page.getByRole('dialog', { name: 'New form' }).getByRole('button', { name: 'Use template: Survey' }).click()
  await expect(page).toHaveURL(/\/dashboard\/forms\/[0-9a-f-]{36}\/build$/)
  const formId = page.url().split('/').at(-2)!

  // Rename it (autosave), then publish.
  const titleInput = page.getByRole('textbox', { name: 'Form title' })
  await titleInput.fill(title)
  await titleInput.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Published. Your form is live.')).toBeVisible()

  const detail = await (await page.request.get(`/api/forms/${formId}`)).json()
  expect(detail.title).toBe(title)
  const def = await liveDefinition(page.request, detail.slug)

  // A respondent, no session: the start screen, then one question at a time by keyboard.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const respondent = await ctx.newPage()
  await respondent.goto(`/f/${detail.slug}`)
  await expect(respondent.getByRole('heading', { name: 'Help us improve' })).toBeVisible()
  await fillByKeyboard(respondent, def, { loadedAt: Date.now() })
  await expectEndScreen(respondent, 'Thank you!')
  await ctx.close()

  // Back in the dashboard: the response is in the table.
  await page.goto(`/dashboard/forms/${formId}/responses?view=table`)
  await expect(page.getByRole('button', { name: /^Open response from/ })).toHaveCount(1)
})
