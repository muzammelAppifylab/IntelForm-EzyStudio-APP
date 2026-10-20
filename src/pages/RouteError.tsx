import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import NotFoundPage from './NotFoundPage'

/** Last-resort screen for errors thrown while rendering a route (including failed lazy chunks). */
export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  console.error(error)
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <title>Something went wrong</title>
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <h1 className="text-title">Something went wrong</h1>
        <p className="text-body text-muted-foreground">Reload the page to try again. If it keeps happening, tell the Owner.</p>
        <Button onClick={() => location.reload()} className="mt-2">Reload</Button>
      </div>
    </main>
  )
}
