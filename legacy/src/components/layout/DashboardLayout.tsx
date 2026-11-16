import { Contact, FileText, LayoutTemplate, Menu, Plus, Settings, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { can, type Permission } from '@shared/roles'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useCan, useMe } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { AccountMenu, BrandMark } from './AccountMenu'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Hidden unless the member's role has this permission. */
  permission?: Permission
  end?: boolean
}

/** Sidebar order from the PRD: Forms, Contacts, Templates, Team, Settings (Owner only). Profile is in the account menu. */
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Forms', icon: FileText, end: true },
  { to: '/dashboard/contacts', label: 'Contacts', icon: Contact, permission: 'responses.view' },
  { to: '/dashboard/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/dashboard/team', label: 'Team', icon: Users },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
]
const PROFILE: NavItem = { to: '/dashboard/profile', label: 'Profile', icon: UserRound }

/** Location state the top bar's New form button sends; the forms page opens its dialog on it. */
export interface NewFormState {
  newForm: number
}

/**
 * Dashboard shell: a flat full-height sidebar on the left (brand, New form, workspace nav, account)
 * and the page beside it. Under md the sidebar becomes a sheet behind a slim top bar.
 */
export default function DashboardLayout() {
  const me = useMe()
  const canEdit = useCan('forms.edit')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useBranding({ accent: true })
  const items = NAV.filter((n) => !n.permission || can(me.role, n.permission))
  const isActive = (n: NavItem) => (n.end ? pathname === n.to : pathname.startsWith(n.to))
  const newForm = () => {
    setMenuOpen(false)
    navigate('/dashboard', { state: { newForm: Date.now() } satisfies NewFormState })
  }

  return (
    <div data-shell="dashboard" className="min-h-svh bg-background text-foreground md:grid md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <meta name="robots" content="noindex" />

      <aside className="sticky top-0 hidden h-svh flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarBody items={items} isActive={isActive} canEdit={canEdit} onNewForm={newForm} />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-(--z-sticky) flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="focus-ring press grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-foreground transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="flex h-full flex-col">
                <SidebarBody items={[...items, PROFILE]} isActive={isActive} canEdit={canEdit} onNewForm={newForm} onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <BrandMark />
          <div className="ml-auto flex items-center gap-2">
            {canEdit && (
              <Button size="sm" onClick={newForm}>
                <Plus aria-hidden />
                New form
              </Button>
            )}
            <AccountMenu />
          </div>
        </header>
        <main key={pathname} className="mx-auto grid w-full animate-fade-up max-w-[72rem] content-start gap-6 px-4 pt-6 pb-16 sm:px-8 md:pt-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarBody({
  items,
  isActive,
  canEdit,
  onNewForm,
  onNavigate,
}: {
  items: NavItem[]
  isActive(n: NavItem): boolean
  canEdit: boolean
  onNewForm(): void
  onNavigate?(): void
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center px-4">
        <BrandMark />
      </div>
      <div className="grid gap-4 px-3 pt-1">
        {canEdit && (
          <Button onClick={onNewForm} className="w-full justify-start">
            <Plus aria-hidden />
            New form
          </Button>
        )}
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3">
        <WorkspaceNav items={items} isActive={isActive} onNavigate={onNavigate} />
      </div>
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <AccountMenu variant="row" />
      </div>
    </>
  )
}

function WorkspaceNav({ items, isActive, onNavigate }: { items: NavItem[]; isActive(n: NavItem): boolean; onNavigate?(): void }) {
  return (
    <nav aria-label="Workspace" className="grid gap-0.5">
      <p className="px-2 pb-1.5 text-overline text-muted-foreground">Workspace</p>
      {items.map((n) => {
        const active = isActive(n)
        return (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'focus-ring press flex h-9 items-center gap-2.5 rounded-md px-2 text-label transition-[background-color,color,scale] duration-(--duration-fast) ease-out',
              active
                ? 'bg-accent font-semibold text-accent-foreground'
                : 'text-sidebar-foreground hover:bg-accent/70 hover:text-accent-foreground',
            )}
          >
            <n.icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} aria-hidden />
            {n.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
