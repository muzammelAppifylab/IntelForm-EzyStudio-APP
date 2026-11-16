/**
 * Joins class names, skipping falsy ones. Plain CSS classes (no Tailwind), so there is nothing
 * to merge: pick a variant with a conditional instead of overriding a class.
 */
export function cn(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Up to two initials for avatar fallbacks: "Ada Lovelace" → "AL". */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]!.toUpperCase())
    .join('');
}
