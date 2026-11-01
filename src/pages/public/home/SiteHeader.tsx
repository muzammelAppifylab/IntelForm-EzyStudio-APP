import { ArrowUpRight, LayoutDashboard } from 'lucide-react'
import { Link } from 'react-router'
import type { PublicHome } from '@shared/api-front'
import { Logo } from '@/components/common/Logo'
import { cn } from '@/components/ui/cn'
import { DISPLAY, SHELL, SITE_NAV, useSignedIn, type SitePageId } from './site'

const NAV_ITEM =
  'focus-ring press inline-flex h-(--control-md) items-center rounded-full border-2 px-4 text-label whitespace-nowrap transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out'
const NAV_IDLE = 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
/** Active page: the selected state (periwinkle fill + 2px ink edge). */
const NAV_ACTIVE = 'border-option-selected-border bg-option-selected text-option-selected-foreground'

/**
 * Site header: the creator's logo and name (home) on the left, the page links on the right. A
 * signed-in team member also gets a Dashboard button; visitors never see it.
 */
export function SiteHeader({ home, current }: { home: PublicHome; current: SitePageId }) {
  const signedIn = useSignedIn()
  return (
    <header className="border-b border-border">
      <div className={cn(SHELL, 'flex min-h-18 items-center justify-between gap-4 py-3')}>
        <Link to="/" aria-current={current === 'home' ? 'page' : undefined} className="focus-ring flex min-w-0 items-center gap-3 rounded-md">
          <Logo logoUrl={home.logoUrl} appName={home.appName} className="size-10" />
          <span className={cn('truncate text-heading-sm', DISPLAY)}>{home.appName}</span>
        </Link>

        <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
          {SITE_NAV.map((n) => (
            <Link key={n.id} to={n.to} aria-current={n.id === current ? 'page' : undefined} className={cn(NAV_ITEM, n.id === current ? NAV_ACTIVE : NAV_IDLE)}>
              {n.label}
            </Link>
          ))}
          {signedIn && (
            <Link
              to="/dashboard"
              className="focus-ring press ml-2 inline-flex h-(--control-md) items-center gap-1.5 rounded-md border-2 border-primary-border bg-secondary px-3 text-label whitespace-nowrap text-secondary-foreground transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent sm:px-4"
            >
              {/* Icon only on phones, so the name keeps its room. */}
              <LayoutDashboard className="size-4 sm:hidden" aria-hidden />
              <span className="sr-only sm:not-sr-only">Dashboard</span>
              <ArrowUpRight className="hidden size-4 sm:block" aria-hidden />
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
