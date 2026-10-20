import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <title>Page not found</title>
      <meta name="robots" content="noindex" />
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <p className="text-overline text-muted-foreground">404</p>
        <h1 className="text-title">Page not found</h1>
        <p className="text-body text-muted-foreground">The link may be mistyped, or the form isn’t accepting responses.</p>
        <Button asChild variant="outline" className="mt-2"><Link to="/">Go to the home page</Link></Button>
      </div>
    </main>
  )
}
