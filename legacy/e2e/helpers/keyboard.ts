import { expect, type Page } from '@playwright/test'
import type { FormDefinition, FormField } from '../../shared/form/definition'
import { SYSTEM_LABELS } from '../../shared/form/labels'
import { validAnswer } from './answers'

/**
 * Completes a live form at /f/:slug with the keyboard only: Tab to move, type into inputs,
 * Space for radios and checkboxes, type-ahead in selects, Enter on Start / OK / Next / Submit.
 * Works for all three layouts, because it reacts to whatever has focus instead of following a
 * script per layout. Fields hidden by logic never get focus, so they are never answered.
 *
 * Values come from the shared answer generator (e2e/helpers/answers.ts), so expectations can
 * be computed from the same source: name "Ada Lovelace", choice = first option, etc.
 */
export interface KeyboardFillOptions {
  /** NPS score to pick (default 9). */
  nps?: number
  /** Text per field id, typed instead of the generated value (short and long text, email). */
  text?: Record<string, string>
  /** Option index (0-based) for single choice / yes-no fields by id. */
  choice?: Record<string, number>
  /** Page load time; the submit waits until the server's minimum fill time has passed. */
  loadedAt?: number
  /** Max key presses before giving up. */
  maxKeys?: number
}

interface Focused {
  tag: string
  type: string | null
  label: string
  text: string
  fieldId: string | null
  checked: boolean
}

const MIN_FILL_MS = 2_500

async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return { tag: 'NONE', type: null, label: '', text: '', fieldId: null, checked: false }
    const input = el as HTMLInputElement
    const labelled = el.getAttribute('aria-label') ?? (input.labels && input.labels[0]?.textContent) ?? ''
    return {
      tag: el.tagName,
      type: el.getAttribute('type'),
      label: labelled.trim(),
      text: (el.textContent ?? '').trim(),
      fieldId: el.closest('[data-field]')?.getAttribute('data-field') ?? null,
      checked: !!input.checked,
    }
  })
}

/** The generated date, in the field's display format (digits only: the input masks them). */
function dateDigits(field: Extract<FormField, { type: 'date' }>): string {
  const iso = validAnswer(field) as string
  const [y, m, d] = iso.split('-')
  switch (field.props.format) {
    case 'MM/DD/YYYY':
      return `${m}${d}${y}`
    case 'YYYY-MM-DD':
      return `${y}${m}${d}`
    default:
      return `${d}${m}${y}`
  }
}

function textFor(field: FormField, control: Focused, opts: KeyboardFillOptions): string | null {
  if (opts.text?.[field.id] !== undefined) return opts.text[field.id]
  const v = validAnswer(field)
  switch (field.type) {
    case 'name':
      if (control.label === SYSTEM_LABELS.firstName) return 'Ada'
      if (control.label === SYSTEM_LABELS.lastName) return 'Lovelace'
      return 'Ada Lovelace'
    case 'phone':
      return control.type === 'tel' ? '+44 20 7946 0958' : null
    case 'address': {
      const byLabel: Record<string, string> = {
        [SYSTEM_LABELS.street]: '1 Main Street',
        [SYSTEM_LABELS.line2]: 'Flat 2',
        [SYSTEM_LABELS.city]: 'London',
        [SYSTEM_LABELS.state]: 'Greater London',
        [SYSTEM_LABELS.postal]: 'SW1A 1AA',
      }
      return byLabel[control.label] ?? null
    }
    case 'date':
      return control.tag === 'INPUT' ? dateDigits(field) : null
    case 'time':
      return control.tag === 'INPUT' ? String(v).replace(':', '') : null
    case 'email':
    case 'short_text':
    case 'long_text':
    case 'url':
    case 'number':
      return String(v)
    default:
      return null
  }
}

/**
 * Fills the form shown on `page` and presses Submit. Resolves after the submit key press;
 * the caller asserts the end screen.
 */
export async function fillByKeyboard(page: Page, def: Pick<FormDefinition, 'fields'>, opts: KeyboardFillOptions = {}): Promise<void> {
  const byId = new Map(def.fields.map((f) => [f.id, f]))
  const handled = new Set<string>()
  const loadedAt = opts.loadedAt ?? Date.now()
  const L = SYSTEM_LABELS
  for (let i = 0; i < (opts.maxKeys ?? 300); i++) {
    // Steps and pages may move focus straight into their first input: answer it before tabbing on.
    let el = await focused(page)
    const fresh = el.fieldId && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tag) && !handled.has(`${el.fieldId}|${el.tag}|${el.type}|${el.label}`) && !handled.has(`${el.fieldId}|${el.type}`)
    if (!fresh) {
      await page.keyboard.press('Tab')
      el = await focused(page)
    }
    if (process.env.E2E_DEBUG_KEYS) console.log('focus', Date.now() % 100000, JSON.stringify({ ...el, text: el.text.slice(0, 30) }))

    if (el.tag === 'BUTTON' && !el.fieldId) {
      const name = el.label || el.text
      if (name === L.start || name.startsWith(L.ok) || name === L.next) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(450) // step transition
        continue
      }
      if (name === L.submit) {
        const wait = loadedAt + MIN_FILL_MS - Date.now()
        if (wait > 0) await page.waitForTimeout(wait)
        await page.keyboard.press('Enter')
        return
      }
      continue
    }

    const field = el.fieldId ? byId.get(el.fieldId) : undefined
    if (!field) continue
    const key = `${field.id}|${el.tag}|${el.type}|${el.label}`
    if (handled.has(key)) continue

    if (el.tag === 'INPUT' && el.type === 'radio') {
      // One handled key per group: the first radio Tab reaches.
      const groupKey = `${field.id}|radio`
      if (handled.has(groupKey)) continue
      handled.add(groupKey)
      if (el.checked) continue
      await page.keyboard.press('Space')
      const steps = field.type === 'nps' ? (opts.nps ?? 9) : (opts.choice?.[field.id] ?? 0)
      for (let s = 0; s < steps; s++) await page.keyboard.press('ArrowRight')
      continue
    }
    if (el.tag === 'INPUT' && el.type === 'checkbox') {
      const groupKey = `${field.id}|checkbox`
      if (handled.has(groupKey)) continue
      handled.add(groupKey)
      if (!el.checked) await page.keyboard.press('Space')
      continue
    }
    if (el.tag === 'SELECT') {
      handled.add(key)
      if (field.type === 'phone') continue // the tel input takes "+44 …" and sets the country
      if (field.type === 'address' || field.type === 'country') await page.keyboard.type('United Kingdom')
      else await page.keyboard.press('ArrowDown') // dropdown: the first option after the placeholder
      continue
    }
    if (el.tag === 'INPUT' || el.tag === 'TEXTAREA') {
      handled.add(key)
      const value = textFor(field, el, opts)
      if (value === null) continue
      await page.keyboard.type(value)
      continue
    }
    // Calendar buttons, combobox triggers etc.: leave them alone.
  }
  throw new Error('fillByKeyboard: never reached the Submit button')
}

/** Waits for the end screen title (with pipes resolved by the caller). */
export async function expectEndScreen(page: Page, title: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 })
}

