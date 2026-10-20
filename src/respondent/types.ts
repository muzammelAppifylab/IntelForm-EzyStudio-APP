import type { ReactNode } from 'react'
import type { FieldOf } from '@shared/form/definition'
import type { FieldType } from '@shared/form/field-types'
import type { Labels } from '@shared/form/labels'

/** What the renderer reports with a change. */
export interface ChangeMeta {
  /**
   * A label code ("invalidDate", "invalidNumber"…) when the raw input can't become an answer yet,
   * e.g. half a date. Blocks Next/Submit like a validation error. null clears it.
   */
  invalid?: string | null
  /** Set programmatically (a default country), not by the respondent: doesn't count as starting. */
  silent?: boolean
}

/**
 * Props every field renderer receives (src/form-types/<type>/Renderer.tsx). Input-type renderers
 * render only the control: FieldBlock renders the label (pointing at `inputId`), the description
 * and the error. Group-type renderers (see GROUP_TYPES) render a fieldset whose legend is `legend`,
 * plus `description` and `error`.
 */
export interface FieldRendererProps<T extends FieldType = FieldType> {
  field: FieldOf<T>
  value: unknown
  onChange: (value: unknown, meta?: ChangeMeta) => void
  labels: Labels
  /** id of the main control; the question label points at it. */
  inputId: string
  /** aria-describedby for the main control (description and error ids). */
  describedBy?: string
  invalid: boolean
  error?: string
  /** Group types: the question heading, for the legend. */
  legend: ReactNode
  /** Group types: the description text (already piped). */
  description?: string
  /** One-at-a-time: larger question type. */
  large: boolean
  /**
   * One-at-a-time: Enter in a single-line input (or Cmd/Ctrl+Enter in long text) calls this.
   * Undefined in the paged layouts, where Enter submits the native form (Next / Submit).
   */
  onAdvance?: () => void
  preview: boolean
}

/** Types whose renderer is a fieldset with its own legend. */
export function isGroupField(field: { type: FieldType; props: unknown }): boolean {
  switch (field.type) {
    case 'single_choice':
    case 'multiple_choice':
    case 'yes_no':
    case 'picture_choice':
    case 'rating':
    case 'nps':
    case 'time':
    case 'address':
    case 'consent':
    case 'signature':
      return true
    case 'name':
      return (field.props as { split?: boolean }).split === true
    default:
      return false
  }
}

/** Auto-advance (one-at-a-time) after a pointer pick: single choice, yes/no, rating, NPS. */
export const AUTO_ADVANCE_TYPES: ReadonlySet<FieldType> = new Set(['single_choice', 'yes_no', 'rating', 'nps'])

/** Long text: Shift+Enter is a newline, Cmd/Ctrl+Enter advances. */
export const MULTILINE_TYPES: ReadonlySet<FieldType> = new Set(['long_text'])
