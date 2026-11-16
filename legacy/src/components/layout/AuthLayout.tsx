import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { Logo } from '@/components/common/Logo'
import { appInfoQuery } from '@/lib/auth'
import { useBranding } from '@/lib/branding'

/** Centered card for setup, login, reset and invite. Never indexed. */
export function AuthLayout() {
  const { data: app } = useQuery(appInfoQuery)
  useBranding({ accent: true })
  const appName = app?.appName ?? 'IntelForm'
  return (
    <div className="grid min-h-svh grid-rows-[1fr_auto] bg-background px-4">
      <meta name="robots" content="noindex" />
      <main className="mx-auto grid w-full max-w-sm content-center gap-8 py-12">
        <div className="flex items-center justify-center gap-2.5">
          <Logo logoUrl={app?.logoUrl} appName={appName} />
          <span className="text-subheading">{appName}</span>
        </div>
        <div className="rounded-xl border bg-card p-6 sm:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** Title + intro at the top of an auth card. */
export function AuthHeading({ title, children }: { title: string; children?: string }) {
  return (
    <div className="mb-6 grid gap-1.5">
      <title>{title}</title>
      <h1 className="text-heading">{title}</h1>
      {children && <p className="text-body text-muted-foreground">{children}</p>}
    </div>
  )
}
