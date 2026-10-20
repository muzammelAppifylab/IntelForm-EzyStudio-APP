import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** The design system's type classes (src/styles/styles.css). Each sets the whole `font` shorthand. */
export const TYPE_CLASSES = [
  'hero',
  'title',
  'heading',
  'heading-sm',
  'subheading',
  'body',
  'body-sm',
  'label',
  'caption',
  'overline',
  'metric',
  'question-xl',
  'question',
  'answer',
] as const

/**
 * tailwind-merge that knows `text-label`, `text-caption`… are font sizes, not colours. The stock
 * merge treats unknown `text-*` values as colours, so `cn('text-label text-muted-foreground')`
 * silently dropped `text-label`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_CLASSES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
