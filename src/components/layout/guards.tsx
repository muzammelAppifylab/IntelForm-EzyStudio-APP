import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router'
import { meQuery, setupStatusQuery } from '@/lib/auth'
import { FullPageSpinner } from './FullPageSpinner'

/** Dashboard guard: sends visitors to /login (or /setup on a fresh install), then back. */
export function RequireUser() {
  const location = useLocation()
  const me = useQuery(meQuery)
  const setup = useQuery({ ...setupStatusQuery, enabled: me.data === null })

  if (me.isPending || (me.data === null && setup.isPending)) return <FullPageSpinner />
  if (me.isError) throw me.error
  if (!me.data) {
    if (setup.data?.needsSetup) return <Navigate to="/setup" replace />
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

/** Login, setup and reset pages: a signed-in member goes straight to the dashboard. */
export function RedirectIfSignedIn() {
  const me = useQuery(meQuery)
  if (me.isPending) return <FullPageSpinner />
  if (me.data) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
