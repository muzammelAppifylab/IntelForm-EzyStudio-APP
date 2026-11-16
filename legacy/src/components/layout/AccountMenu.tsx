import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react'
import { Link } from 'react-router'
import { ROLE_LABEL } from '@shared/roles'
import { Logo } from '@/components/common/Logo'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/components/ui/cn'
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
import { appInfoQuery, useLogout, useMe } from '@/lib/auth'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { initials } from '@/lib/utils'

/** The app's logo (when uploaded) and name, linking back to the forms list. */
export function BrandMark({ className }: { className?: string }) {
  const { data: app } = useQuery(appInfoQuery)
  const appName = app?.appName ?? 'IntelForm'
  return (
    <Link to="/dashboard" className={cn('focus-ring flex min-w-0 shrink-0 items-center gap-2.5 rounded-md', className)}>
      <Logo logoUrl={app?.logoUrl} appName={appName} className="size-7" />
      <span className="truncate text-heading-sm">{appName}</span>
    </Link>
  )
}

/**
 * Account menu: profile, theme and log out. `row` is the sidebar footer (avatar, name and role);
 * `avatar` is the compact round trigger for the mobile top bar.
 */
export function AccountMenu({ variant = 'avatar' }: { variant?: 'row' | 'avatar' }) {
  const me = useMe()
  const logout = useLogout()
  const { preference, setPreference } = useTheme()
  const row = variant === 'row'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${me.name}, ${ROLE_LABEL[me.role]}: account menu`}
        className={cn(
          'focus-ring press cursor-pointer text-left transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent data-[state=open]:bg-accent',
          row ? 'flex w-full items-center gap-2.5 rounded-md p-2' : 'grid size-9 shrink-0 place-items-center rounded-full p-0.5',
        )}
      >
        <Avatar className={row ? 'size-8 shrink-0' : 'size-full'}>
          {me.avatarUrl && <AvatarImage src={me.avatarUrl} alt="" />}
          <AvatarFallback className="bg-primary text-caption font-semibold text-primary-foreground">{initials(me.name)}</AvatarFallback>
        </Avatar>
        {row && (
          <>
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-label">{me.name}</span>
              <span className="truncate text-caption text-muted-foreground">{ROLE_LABEL[me.role]}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={row ? 'start' : 'end'} side={row ? 'top' : 'bottom'} className="w-60">
        <DropdownMenuLabel className="grid font-normal">
          <span className="text-label">{me.name}</span>
          <span className="truncate text-caption text-muted-foreground">
            {me.email} · {ROLE_LABEL[me.role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard/profile">
            <UserRound aria-hidden /> Profile
          </Link>
        </DropdownMenuItem>
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
  )
}
