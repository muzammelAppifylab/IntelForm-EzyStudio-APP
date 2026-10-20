import { describe, expect, it } from 'vitest'
import { FIELD, FORM_FONT, FORM_RADIUS, INPUT_EXTRA, TILE_BASE, TILE_REST, TILE_SELECTED } from '@/components/ds/tokens'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { fieldClasses } from '@/components/ui/input'
import { formButtonClass, iconButtonClass, inputClass, smallButtonClass } from './classes'
import { CONTROL, CONTROL_BOX } from './util'

/**
 * The public form builds its classes with plain clsx (no tailwind-merge in its bundle). These pin
 * each respondent class list to what cn (tailwind-merge) produced from the ui components and
 * overrides it replaced, so the two can't drift apart.
 */
const set = (classes: string) => new Set(classes.split(/\s+/).filter(Boolean))
const noDupes = (classes: string) => expect(classes.split(/\s+/).filter(Boolean).length).toBe(set(classes).size)

describe('respondent classes match the merged ui classes', () => {
  it('input', () => {
    const ui = (className: string) => cn(fieldClasses, 'h-(--control-md) px-3 py-1', INPUT_EXTRA, className)
    expect(set(inputClass())).toEqual(set(ui(CONTROL)))
    expect(set(inputClass('pr-10'))).toEqual(set(ui(cn(CONTROL, 'pr-10'))))
    expect(set(inputClass('max-w-60 tabular-nums'))).toEqual(set(ui(cn(CONTROL, 'max-w-60 tabular-nums'))))
    noDupes(inputClass())
  })

  it('buttons', () => {
    for (const variant of ['default', 'outline'] as const) {
      const merged = cn(buttonVariants({ variant, size: 'lg', className: cn('rounded-[var(--form-radius)]', FORM_FONT, 'w-fit') }))
      expect(set(formButtonClass(variant, 'w-fit'))).toEqual(set(merged))
    }
    expect(set(iconButtonClass)).toEqual(set(cn(buttonVariants({ variant: 'outline', size: 'icon-lg', className: 'rounded-[min(var(--form-radius),0.75rem)]' }))))
    expect(set(smallButtonClass)).toEqual(set(cn(buttonVariants({ variant: 'outline', size: 'sm' }))))
  })

  it('tiles and controls', () => {
    const TILE = `relative flex cursor-pointer items-center ${TILE_REST} ${TILE_BASE.replace('relative flex cursor-pointer ', '')}`
    for (const checked of [false, true]) {
      const extra = 'min-h-(--control-lg) items-start gap-3 px-4 py-3 text-answer'
      const mine = [TILE_BASE, checked ? TILE_SELECTED : TILE_REST, FORM_RADIUS, FORM_FONT, extra].join(' ')
      expect(set(mine)).toEqual(set(cn(TILE, FORM_RADIUS, FORM_FONT, extra, checked && TILE_SELECTED)))
      noDupes(mine)
    }
    expect(set(`${CONTROL_BOX} px-0`)).toEqual(set(cn(CONTROL, 'px-0')))
    expect(set(`${FIELD} flex field-sizing-content min-h-24 px-4 py-3 text-answer ${FORM_FONT} ${FORM_RADIUS}`)).toEqual(
      set(cn(fieldClasses, 'flex field-sizing-content min-h-24 px-3 py-2', 'px-4 py-3 text-answer', FORM_FONT, FORM_RADIUS)),
    )
  })
})
