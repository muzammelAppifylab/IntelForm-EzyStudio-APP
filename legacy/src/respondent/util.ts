import type { KeyboardEvent } from 'react'
import { FORM_FONT, FORM_RADIUS } from '@/components/ds/tokens'
import { clsx } from 'clsx'

/** Respondent helpers shared by the renderers and layouts (no components here). */

/*
 * The public form joins classes with plain clsx, not tailwind-merge (it would cost ~9 KB gzip), so
 * a class list must never hold two classes for the same property: pick the variant with a
 * conditional instead of overriding.
 */

/** 48px themed control box (TextField size lg) without horizontal padding. */
export const CONTROL_BOX = clsx('h-(--control-lg) text-answer', FORM_FONT, FORM_RADIUS)

/** 48px themed text control (TextField size lg). */
export const CONTROL = clsx(CONTROL_BOX, 'px-4')

/**
 * Enter in a single-line input advances (one-at-a-time). Ignored during IME composition and with
 * modifiers; without `onAdvance` the native form handles Enter (Next / Submit).
 */
export function enterToAdvance(e: KeyboardEvent<HTMLElement>, onAdvance?: () => void): void {
  if (!onAdvance || e.key !== 'Enter') return
  if (e.nativeEvent.isComposing || e.keyCode === 229) return
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
  e.preventDefault()
  onAdvance()
}

/** Fisher–Yates with a seed, so a randomised option order stays put while the form is open. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let s = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Region names in the respondent's language (falls back to English, then the code). */
let regionNames: Intl.DisplayNames | null | undefined
export function regionName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames([document.documentElement.lang || navigator.language, 'en'], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

/** The respondent's likely country from the browser language ("en-GB" → "GB"). */
export function guessCountry(): string | null {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const m = /-([A-Z]{2})\b/i.exec(lang)
    if (m) return m[1].toUpperCase()
  }
  return null
}
