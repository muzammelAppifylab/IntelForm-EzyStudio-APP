/** Class merging that knows the design system's type classes (text-label, text-caption…). */
export { cn } from '@/components/ui/cn'

/** Up to two initials for avatar fallbacks: "Ada Lovelace" → "AL". */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}
