import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Respondent end to end: a published form answered by keyboard only in all three layouts, the
 * end screen with piping, axe (WCAG 2.1 AA) on each layout, and an inline embed that resizes.
 * In the full suite the platform spec has run setup; on a fresh install this runs it.
 */
// Same Owner as e2e/platform.spec.ts (importing a spec file would register its tests twice).
const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1', appName: 'Acme forms' }
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

test.describe.configure({ mode: 'serial' })

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

type Layout = 'all_at_once' | 'section_by_section' | 'one_at_a_time'

function definition(layout: Layout) {
  return {
    layout,
    startScreen: { enabled: false, title: '', button: 'Start' },
    endScreen: { title: 'Thanks, {f_kbname}!', message: 'We will write to {f_kbmail}.' },
    fields: [
      ...(layout === 'one_at_a_time' ? [] : [{ id: 'f_kbsec1', type: 'section_break', label: 'About you', required: false, props: {} }]),
      { id: 'f_kbname', type: 'short_text', label: 'Your name', required: true, props: {} },
      { id: 'f_kbmail', type: 'email', label: 'Hi {f_kbname}, your email?', required: true, props: {} },
      ...(layout === 'one_at_a_time' ? [] : [{ id: 'f_kbsec2', type: 'section_break', label: 'Experience', required: false, props: {} }]),
      { id: 'f_kbused', type: 'yes_no', label: 'Used a form builder before?', required: true, props: {} },
      {
        id: 'f_kbwhich',
        type: 'short_text',
        label: 'Which one?',
        required: true,
        props: {},
        logic: { action: 'show', match: 'all', conditions: [{ field: 'f_kbused', op: 'is_yes' }] },
      },
      { id: 'f_kbnps', type: 'nps', label: 'How likely are you to recommend us?', required: true, props: {} },
    ],
  }
}

async function publishForm(page: Page, origin: string, layout: Layout): Promise<{ id: string; slug: string }> {
  const headers = { origin }
  const created = await page.request.post('/api/forms', { headers, data: { title: `Keyboard ${layout}` } })
  expect(created.status()).toBe(201)
  const form = (await created.json()) as { id: string; slug: string }
  const patch = await page.request.patch(`/api/forms/${form.id}`, { headers, data: { draft: definition(layout), settings: { turnstile: false } } })
  expect(patch.status(), await patch.text()).toBe(200)
  const pub = await page.request.post(`/api/forms/${form.id}/publish`, { headers, data: {} })
  expect(pub.status(), await pub.text()).toBe(200)
  return form
}

async function axe(page: Page) {
  // Let the step transition finish: mid-fade colours aren't the real contrast.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const forms = {} as Record<Layout, { id: string; slug: string }>

test.beforeAll(async ({ browser, baseURL }) => {
  const page = await browser.newPage()
  await signIn(page)
  const origin = new URL(baseURL!).origin
  for (const layout of ['all_at_once', 'section_by_section', 'one_at_a_time'] as const) forms[layout] = await publishForm(page, origin, layout)
  await page.close()
})

test('all at once: error summary, then a keyboard-only submit', async ({ page }) => {
  await page.goto(`/f/${forms.all_at_once.slug}`)
  await expect(page.getByRole('heading', { name: 'Keyboard all_at_once', level: 1 })).toBeVisible()
  await axe(page)

  // Submit empty: the summary takes focus and links to each problem.
  await page.getByRole('button', { name: 'Submit' }).focus()
  await page.keyboard.press('Enter')
  const summary = page.getByRole('heading', { name: 'Fix these problems to continue' })
  await expect(summary).toBeVisible()
  await expect(page.locator('[aria-labelledby="if-error-summary"]')).toBeFocused()
  await expect(page).toHaveTitle(/^Error: /)
  await axe(page)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Your name')).toBeFocused()

  await page.keyboard.type('Ada')
  await page.keyboard.press('Tab')
  await page.keyboard.type('ada@example.com')
  await expect(page.getByText('Hi Ada, your email?')).toBeVisible()
  await page.keyboard.press('Tab') // Yes / No group
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab') // revealed by logic
  await expect(page.getByLabel('Which one?')).toBeFocused()
  await page.keyboard.type('Typeform')
  await page.keyboard.press('Tab') // NPS 0
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Submit' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Thanks, Ada!' })).toBeFocused()
  await expect(page.getByText('We will write to ada@example.com.')).toBeVisible()
  await axe(page)
})

test('section by section: Next validates the page, Back keeps answers', async ({ page }) => {
  await page.goto(`/f/${forms.section_by_section.slug}`)
  await expect(page.getByRole('main').getByText('Step 1 of 2')).toBeVisible()
  await axe(page)

  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Your name')).toBeFocused()
  await page.keyboard.press('Enter') // Next with nothing filled: focus the first invalid field
  await expect(page.getByText('This question is required').first()).toBeVisible()
  await expect(page.getByLabel('Your name')).toBeFocused()
  await page.keyboard.type('Grace')
  await page.keyboard.press('Tab')
  await page.keyboard.type('grace@example.com')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('main').getByText('Step 2 of 2')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Experience' })).toBeFocused()
  await expect(page).toHaveTitle(/^Step 2 of 2 – /)
  await axe(page)
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowRight') // No: the follow-up stays hidden
  await expect(page.getByLabel('Which one?')).toHaveCount(0)
  await page.keyboard.press('Tab')
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Tab') // Back
  await page.keyboard.press('Tab') // Submit
  await expect(page.getByRole('button', { name: 'Submit' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Thanks, Grace!' })).toBeFocused()
})

test('one at a time: Enter advances, progress and title follow the step', async ({ page }) => {
  await page.goto(`/f/${forms.one_at_a_time.slug}`)
  await expect(page.getByRole('main').getByText('Question 1 of 4')).toBeVisible()
  await expect(page.getByLabel('Your name')).toBeFocused()
  await axe(page)

  await page.keyboard.type('Alan')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main').getByText('Question 2 of 4')).toBeVisible()
  await expect(page).toHaveTitle(/^Question 2 of 4 – Keyboard one_at_a_time$/)
  await expect(page.getByLabel('Hi Alan, your email?')).toBeFocused()
  await page.keyboard.type('not-an-email')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Enter an email address like name@example.com')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('alan@example.com')
  await page.keyboard.press('Enter')

  // Yes / No: heading focused, keyboard selection never auto-advances.
  await expect(page.getByRole('heading', { name: /Used a form builder before/ })).toBeFocused()
  await axe(page)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Space')
  await expect(page.getByRole('main').getByText('Question 3 of 5')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByRole('main').getByText('Question 3 of 5')).toBeVisible()
  await page.keyboard.press('Tab') // OK
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Which one?')).toBeFocused()
  await page.keyboard.type('Tally')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('main').getByText('Question 5 of 5')).toBeVisible()
  await page.keyboard.press('Tab')
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Submit' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Thanks, Alan!' })).toBeFocused()
  await expect(page.getByText('We will write to alan@example.com.')).toBeVisible()
  await axe(page)
})

test('a pointer pick auto-advances single-choice questions in one at a time', async ({ page }) => {
  await page.goto(`/f/${forms.one_at_a_time.slug}`)
  await page.getByLabel('Your name').fill('Bo')
  await page.getByRole('button', { name: 'OK' }).click()
  await page.getByLabel('Hi Bo, your email?').fill('bo@example.com')
  await page.getByRole('button', { name: 'OK' }).click()
  await page.getByText('No', { exact: true }).click()
  await expect(page.getByRole('main').getByText('Question 4 of 4')).toBeVisible()
})

test('the inline embed sizes its iframe to the form', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const head = await page.request.get(`/f/${forms.all_at_once.slug}`)
  const csp = head.headers()['content-security-policy']
  // The production server frames /f/* anywhere; Vite's dev server sends no CSP.
  if (csp) {
    expect(csp).toContain('frame-ancestors *')
    expect(head.headers()['x-frame-options']).toBeUndefined()
  }
  // A host page on another origin (a real local server: Chrome won't let a mocked "public" page reach localhost).
  const html = `<!doctype html><html lang="en"><head><title>Host</title></head><body style="margin:0">
    <h1>Our site</h1>
    <iframe data-intelform title="Survey" src="${origin}/f/${forms.all_at_once.slug}?embed=1&transparent=1&hideTitle=1" style="width:100%;border:0;height:150px"></iframe>
    <script src="${origin}/embed.js"></script></body></html>`
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await page.goto(`http://127.0.0.1:${port}/`)
  const iframe = page.locator('iframe[data-intelform]')
  await expect.poll(async () => Number.parseInt((await iframe.getAttribute('style'))!.match(/height:\s*(\d+)/)![1], 10), { timeout: 15_000 }).toBeGreaterThan(400)
  const before = await iframe.evaluate((el) => (el as HTMLElement).offsetHeight)

  // Revealing the follow-up question grows the iframe.
  const frame = page.frameLocator('iframe[data-intelform]')
  await expect(frame.locator('h1')).toHaveClass(/sr-only/)
  await frame.getByText('Yes', { exact: true }).click()
  await expect(frame.getByLabel('Which one?')).toBeVisible()
  await expect.poll(() => iframe.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThan(before)
  server.close()
})
