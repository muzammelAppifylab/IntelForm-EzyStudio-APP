import { GalleryVertical, Layers, Rows3, type LucideIcon } from 'lucide-react'
import type { TemplateSummary } from '@shared/api-forms'
import type { Layout } from '@shared/form/definition'

export const LAYOUT_ICON: Record<Layout, LucideIcon> = {
  all_at_once: Rows3,
  section_by_section: Layers,
  one_at_a_time: GalleryVertical,
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n)
}

export function groupByCategory(templates: TemplateSummary[], categories: string[]) {
  return categories
    .map((category) => ({ category, items: templates.filter((t) => t.category === category) }))
    .filter((g) => g.items.length > 0)
}
