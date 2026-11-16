import { expect, test } from '@playwright/test'

/**
 * Forms management, end to end: Owner → create from a template → list → duplicate → close →
 * delete. In the full suite the platform spec has already run setup, so this logs in as its
 * Owner; on a fresh install (e.g. E2E_BASE_URL=http://localhost:5184) it runs setup itself.
 */
// Same Owner as e2e/platform.spec.ts (importing a spec file would register its tests twice).
const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }

test('owner creates, duplicates, closes and deletes a form', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const { needsSetup } = await (await page.request.get('/api/setup')).json()
  if (needsSetup) {
    await page.goto('/setup')
    await page.getByLabel('Your name').fill(OWNER.name)
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByLabel('App name').fill(OWNER.appName)
    await page.getByRole('button', { name: /create|set up|continue/i }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    // Empty state on a fresh install.
    await expect(page.getByRole('heading', { name: 'Make your first form' })).toBeVisible()
  } else {
    await page.goto('/login')
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  }

  // New form → pick a template → lands in the builder.
  await page.getByRole('button', { name: 'New form' }).click()
  const dialog = page.getByRole('dialog', { name: 'New form' })
  await dialog.getByRole('button', { name: 'Use template: Lead capture' }).click()
  await expect(page).toHaveURL(/\/dashboard\/forms\/[0-9a-f-]{36}\/build$/)
  const formId = page.url().split('/').at(-2)!

  // It appears in the list.
  await page.goto('/dashboard')
  const card = (title: string) => page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })
  await expect(card('Lead capture')).toBeVisible()
  await expect(card('Lead capture')).toContainText('Draft')

  // Duplicate.
  await page.getByRole('button', { name: 'Actions for Lead capture', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByText('Form duplicated')).toBeVisible()
  await expect(card('Copy of Lead capture')).toBeVisible()
  await expect(card('Copy of Lead capture')).toContainText('Draft')

  // Publish (the builder's job) through the API, then close from the list.
  const publish = await page.request.post(`/api/forms/${formId}/publish`, { headers: { origin }, data: {} })
  expect(publish.status()).toBe(200)
  await page.reload()
  await expect(card('Lead capture')).toContainText('Live')
  await page.getByRole('button', { name: 'Actions for Lead capture', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close form' }).click()
  await expect(page.getByText('Form closed')).toBeVisible()
  await expect(card('Lead capture')).toContainText('Closed')

  // Delete needs the title typed exactly.
  await page.getByRole('button', { name: 'Actions for Lead capture', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this form?' })
  await expect(confirm).toContainText('deleted too')
  const deleteButton = confirm.getByRole('button', { name: 'Delete form' })
  await confirm.getByRole('textbox').fill('lead capture')
  await expect(deleteButton).toBeDisabled()
  await confirm.getByRole('textbox').fill('Lead capture')
  await deleteButton.click()
  await expect(page.getByText('Form deleted')).toBeVisible()
  await expect(card('Lead capture')).toHaveCount(0)
  await expect(card('Copy of Lead capture')).toBeVisible()
})
