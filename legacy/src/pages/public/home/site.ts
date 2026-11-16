import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { PublicHome } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import { api } from '@/lib/api'
import { meQuery } from '@/lib/auth'

export const publicHomeQuery = { queryKey: ['public-home'], queryFn: () => api<PublicHome>('/api/public/home') }

/** Display face of the site's preset (the type tokens resolve on :root, so set it explicitly). */
export const DISPLAY = 'font-(family-name:--form-question-font)'
export const SHELL = 'mx-auto w-full max-w-(--content-width) px-4 sm:px-6 lg:px-8'

/** Large site buttons (hero, calls to action), shaped by the preset's radius. */
const BUTTON =
  'focus-ring press inline-flex h-(--control-lg) items-center gap-2 rounded-(--form-radius) border-2 border-primary-border px-6 text-answer font-medium whitespace-nowrap transition-[background-color,scale] duration-(--duration-fast) ease-out'
export const PRIMARY_BUTTON = cn(BUTTON, 'bg-primary text-primary-foreground hover:bg-primary-hover')
export const SECONDARY_BUTTON = cn(BUTTON, 'bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground')

/** The public site's pages. Add a page here, in router.tsx and as a file in pages/public. */
export type SitePageId = 'home' | 'forms' | 'about' | 'legal'

/** Header links (the name on the left goes home). Privacy and Terms are in the footer. */
export const SITE_NAV: { id: SitePageId; label: string; to: string }[] = [{ id: 'about', label: 'About', to: '/about' }]

/** The signed-in team member, if any: null for visitors. Never blocks the page. */
export function useSignedIn(): boolean {
  return !!useQuery({ ...meQuery, retry: false }).data
}

/**
 * The page follows its preset, not the visitor's light/dark setting: the tokens the preset
 * doesn't set (status colours) must match it. Restored on the way out.
 */
export function usePresetScheme(mode: 'light' | 'dark') {
  useEffect(() => {
    const root = document.documentElement
    const was = root.classList.contains('dark')
    root.classList.toggle('dark', mode === 'dark')
    return () => {
      root.classList.toggle('dark', was)
    }
  }, [mode])
}
