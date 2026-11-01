import type { Engine, TtcClock } from '../engine'

export type SubmitOutcome = { ok: true } | { ok: false; errors: Record<string, string> }

/** A button next to a submit-level error, e.g. Reload when the form was republished. */
export interface FormErrorAction {
  label: string
  run: () => void
}

/** What FormRenderer hands each layout. */
export interface LayoutContext {
  engine: Engine
  ttc: TtcClock
  preview: boolean
  /** Focus inputs (not just headings) on step changes: desktop pointer, not the mobile preview. */
  focusInputs: boolean
  /** Move focus at all (false on the very first render of a preview). */
  allowFocus: () => boolean
  title?: string
  hideTitle?: boolean
  center: boolean
  submitting: boolean
  formError: string | null
  formErrorAction?: FormErrorAction | null
  /** Final validation, then the network (or the end screen in preview). */
  submit: () => Promise<SubmitOutcome>
  /** The form's step sound, when moving forward to the next question or section. */
  playStep: () => void
  markStarted: () => void
  /** "Question 3 of 8" → document.title (live) and the polite live region. */
  announce: (status: string | null, opts?: { error?: boolean }) => void
  /** The page scroller: the window, or the preview container. */
  scrollTop: () => void
}

/** Focus the step's heading, or its first text-like input on desktop. */
export function focusStep(container: HTMLElement | null, preferInput: boolean): void {
  if (!container) return
  if (preferInput) {
    // The question's main control (id `if-…`) first: a phone's country picker comes before its number box.
    const typing = 'input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not(.sr-only), textarea, select'
    const main = typing.split(', ').map((s) => `${s}[id^="if-"]`).join(', ')
    const input = container.querySelector<HTMLElement>(main) ?? container.querySelector<HTMLElement>(typing)
    if (input) {
      input.focus({ preventScroll: true })
      return
    }
  }
  container.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true })
}
