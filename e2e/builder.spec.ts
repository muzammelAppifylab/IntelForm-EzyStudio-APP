import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Builder, end to end: add questions by click, drag and keyboard, reorder by keyboard, add a
 * logic rule, pipe an answer, undo, reload to see the autosaved draft, change the theme
 * preset, publish, copy the link and open the public form.
 *
 * In the full suite the platform spec has already run setup; on a fresh install (for example
 * E2E_BASE_URL=http://localhost:5186) this spec runs setup itself.
 */
const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }

async function signIn(page: Page) {
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
  await expect(page).toHaveURL(/\/dashboard$/)
}

const cards = (page: Page) => page.getByRole('list', { name: 'Questions' }).locator('[data-card-id]')
const card = (page: Page, label: string | RegExp) => cards(page).filter({ hasText: label })

async function waitSaved(page: Page) {
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'saved', { timeout: 10_000 })
}

async function cardLabels(page: Page): Promise<string[]> {
  return cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
}

/** Pointer drag with intermediate moves, so dnd-kit's pointer sensor activates. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.up()
}

test('build a form: add, reorder, logic, piping, undo, autosave, theme, publish, share', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000)
  const origin = new URL(baseURL!).origin
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)

  // Create a blank form through the forms API and open the builder.
  const res = await page.request.post('/api/forms', { headers: { origin }, data: { title: 'Builder e2e' } })
  expect(res.status()).toBe(201)
  const { id: formId, slug } = (await res.json()) as { id: string; slug: string }
  await page.goto(`/dashboard/forms/${formId}/build`)
  await expect(page.getByRole('heading', { name: 'Add your first question' })).toBeVisible()

  // 1. Click in the palette appends; the new label takes focus.
  await page.getByRole('button', { name: 'Add Short text' }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Question label' })).toBeFocused()
  await page.keyboard.type('What is your name?')
  await expect(card(page, 'What is your name?')).toHaveCount(1)

  // 2. Drag from the palette onto the canvas (the drop zone under the last question).
  await drag(page, page.getByRole('button', { name: 'Add Email' }), page.getByRole('button', { name: 'Add a question' }))
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Question label' })).toBeFocused()
  await page.keyboard.type('Your email')
  await expect(card(page, 'Your email')).toHaveCount(1)

  // 3. Keyboard: Escape leaves the editor, / opens the insert menu below the selection.
  await page.keyboard.press('Escape')
  await page.locator('[data-card-id]').filter({ hasText: 'Your email' }).focus()
  await page.keyboard.press('/')
  const insert = page.getByRole('dialog', { name: 'Add a question' })
  await expect(insert).toBeVisible()
  await page.keyboard.type('NPS')
  await insert.getByRole('option', { name: 'NPS' }).click()
  await expect(cards(page)).toHaveCount(3)
  await page.keyboard.type('How likely are you to recommend us?')
  expect(await cardLabels(page)).toEqual(['Question 1: What is your name?', 'Question 2: Your email', 'Question 3: How likely are you to recommend us?'])

  // 4. Reorder by keyboard: Cmd/Ctrl+Shift+Up on the focused card moves it up.
  await page.keyboard.press('Escape')
  await card(page, 'How likely').focus()
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp')
  await expect.poll(() => cardLabels(page)).toEqual(['Question 1: What is your name?', 'Question 2: How likely are you to recommend us?', 'Question 3: Your email'])
  // And back down with the "Move down" menu item (the non-drag alternative).
  await card(page, 'How likely').getByRole('button', { name: /More actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Move down' }).click()
  await expect.poll(() => cardLabels(page)).toEqual(['Question 1: What is your name?', 'Question 2: Your email', 'Question 3: How likely are you to recommend us?'])

  // 5. Logic rule on the email question: shown when the name is not empty.
  await card(page, 'Your email').click()
  const settings = page.getByRole('complementary', { name: 'Settings' })
  await settings.getByRole('tab', { name: 'Logic' }).click()
  await settings.getByRole('button', { name: 'Add a rule' }).click()
  await settings.getByRole('combobox', { name: 'Comparison for condition 1' }).click()
  await page.getByRole('option', { name: 'is not empty' }).click()
  await expect(card(page, 'Your email')).toContainText('Shown when What is your name? is not empty')

  // 6. Pipe the name into the NPS label, with a fallback.
  await card(page, 'How likely').locator('p').first().click()
  const label = page.getByRole('textbox', { name: 'Question label' })
  await expect(label).toBeFocused()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await page.keyboard.press('End')
  await page.keyboard.type(' @')
  const listbox = page.getByRole('listbox', { name: 'Earlier answers' })
  await expect(listbox).toBeVisible()
  await expect(listbox.getByRole('option')).toHaveCount(2)
  await listbox.getByRole('option', { name: 'What is your name?' }).click()
  await page.getByLabel('Fallback text').fill('friend')
  await page.getByRole('button', { name: 'Save fallback' }).click()
  await expect(label.locator('[data-pipe]')).toContainText('What is your name?')

  // 7. Undo: delete the email question with the Delete key, then Cmd/Ctrl+Z brings it back.
  await page.keyboard.press('Escape')
  await card(page, 'Your email').focus()
  await page.keyboard.press('Delete')
  await expect(cards(page)).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(cards(page)).toHaveCount(3)
  await expect(card(page, 'Your email')).toContainText('Shown when')

  // 8. Autosave: reload and everything is still there.
  await waitSaved(page)
  await page.reload()
  await expect(cards(page)).toHaveCount(3)
  expect(await cardLabels(page)).toEqual(['Question 1: What is your name?', 'Question 2: Your email', 'Question 3: How likely are you to recommend us? [What is your name?]'])
  await expect(card(page, 'Your email')).toContainText('Shown when What is your name? is not empty')
  await expect(card(page, 'How likely')).toContainText('What is your name? · or “friend”')
  const saved = await (await page.request.get(`/api/forms/${formId}`)).json()
  expect(saved.draft.fields[2].label).toMatch(/^How likely are you to recommend us\? \{f_[a-z0-9]+\|friend\}$/)

  // 9. Design: pick the Midnight preset; it is saved too.
  await page.getByRole('link', { name: 'Design' }).click()
  await page.getByRole('button', { name: /Midnight/ }).click()
  await expect(page.getByRole('button', { name: /Midnight/ })).toHaveAttribute('aria-pressed', 'true')
  await waitSaved(page)
  await page.reload()
  await expect(page.getByRole('button', { name: /Midnight/ })).toHaveAttribute('aria-pressed', 'true')

  // 10. Publish.
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Published. Your form is live.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Published' })).toBeDisabled()
  // A published form shows no status badge in the builder header (only drafts show "Draft").
  await expect(page.locator('header [data-status]')).toHaveCount(0)

  // 11. Share: copy the link.
  await page.getByRole('link', { name: 'Share' }).click()
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Link copied', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/f/${slug}`)

  // 12. The public form shows the published questions.
  await page.goto(`/f/${slug}`)
  await expect(page.getByText('What is your name?').first()).toBeVisible({ timeout: 15_000 })
})
