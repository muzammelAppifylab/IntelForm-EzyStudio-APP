import type { ReactNode } from 'react'
import type { PublicHome } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import type { SitePageId } from './site'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { SITE_PRESET, siteThemeStyle } from './theme'

/**
 * Theme root, header and footer shared by every public page (home, forms, about,
 * legal). Styled by the site's theme preset (`SITE_THEME_ID`) on top of the design system tokens.
 */
export function SiteFrame({ home, current, className, children }: { home: PublicHome; current: SitePageId; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('form-theme flex min-h-dvh flex-col bg-background text-body text-foreground', SITE_PRESET.mode === 'dark' && 'dark', className)}
      style={siteThemeStyle(SITE_PRESET)}
    >
      <SiteHeader home={home} current={current} />
      <main id="main" className="flex flex-1 flex-col gap-16 pb-16 sm:gap-24 sm:pb-24">
        {children}
      </main>
      <SiteFooter home={home} />
    </div>
  )
}
