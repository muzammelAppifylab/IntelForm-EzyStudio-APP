import { useQuery } from '@tanstack/react-query'
import { FileText, Globe, LayoutTemplate, LogOut, Monitor, Moon, Settings, Sun, UserRound, Users, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { can, ROLE_LABEL, type Permission } from '@shared/roles'
import { Logo } from '@/components/common/Logo'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { appInfoQuery, useLogout, useMe } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { initials } from '@/lib/utils'
import { useTheme, type ThemePreference } from '@/lib/theme'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Hidden unless the member's role has this permission. */
  permission?: Permission
  end?: boolean
}

/** Sidebar order from the PRD: Forms, Templates, Front page, Team, Settings (Owner only), Profile. */
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Forms', icon: FileText, end: true },
  { to: '/dashboard/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/dashboard/front-page', label: 'Front page', icon: Globe },
  { to: '/dashboard/team', label: 'Team', icon: Users },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
  { to: '/dashboard/profile', label: 'Profile', icon: UserRound },
]

export default function DashboardLayout() {
  const me = useMe()
  const { data: app } = useQuery(appInfoQuery)
  const { pathname } = useLocation()
  useBranding({ accent: true })
  const appName = app?.appName ?? 'IntelForm'
  const items = NAV.filter((n) => !n.permission || can(me.role, n.permission))
  // Forms is active on the list and inside the builder.
  const isActive = (n: NavItem) => (n.end ? pathname === n.to || pathname.startsWith('/dashboard/forms') : pathname.startsWith(n.to))

  return (
    // Between 768 and 1024px the expanded sidebar leaves too little room, so start on the icon rail.
    <SidebarProvider defaultOpen={window.matchMedia('(min-width: 1024px)').matches}>
      <meta name="robots" content="noindex" />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-10 items-center gap-2.5 px-1">
            <Logo logoUrl={app?.logoUrl} appName={appName} className="size-7" />
            <span className="truncate text-subheading group-data-[collapsible=icon]:hidden">{appName}</span>
            {/* Collapsed rail without a logo: show the app's initials so the header isn't empty. */}
            {!app?.logoUrl && (
              <span aria-hidden className="hidden size-7 place-items-center rounded-md bg-accent text-caption font-semibold text-accent-foreground group-data-[collapsible=icon]:grid">
                {initials(appName)}
              </span>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((n) => (
                  <SidebarMenuItem key={n.to}>
                    <SidebarMenuButton asChild isActive={isActive(n)} tooltip={n.label}>
                      <NavLink to={n.to} end={n.end}>
                        <n.icon aria-hidden />
                        <span>{n.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <UserMenu />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="sticky top-0 z-(--z-sticky) flex h-12 items-center border-b bg-background/90 px-3 backdrop-blur md:hidden">
          <SidebarTrigger />
        </div>
        <main className="mx-auto grid w-full max-w-6xl content-start gap-8 p-4 md:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function UserMenu() {
  const me = useMe()
  const logout = useLogout()
  const { preference, setPreference } = useTheme()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-accent">
              <Avatar className="size-8">
                {me.avatarUrl && <AvatarImage src={me.avatarUrl} alt="" />}
                <AvatarFallback className="bg-accent text-caption font-semibold text-accent-foreground">{initials(me.name)}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 text-start leading-tight">
                <span className="truncate text-label">{me.name}</span>
                <span className="truncate text-caption text-muted-foreground">{ROLE_LABEL[me.role]}</span>
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuLabel className="grid font-normal">
              <span className="text-label">{me.name}</span>
              <span className="text-caption text-muted-foreground">{me.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-overline text-muted-foreground">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
              <DropdownMenuRadioItem value="light"><Sun aria-hidden /> Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark"><Moon aria-hidden /> Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system"><Monitor aria-hidden /> System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout.mutate()}>
              <LogOut aria-hidden /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
