import { Link } from 'react-router'
import type { PublicHome } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import { SHELL, useSignedIn } from './site'

const YEAR = new Date().getFullYear()
const LINK = 'focus-ring inline-flex min-h-11 items-center rounded-sm text-body-sm text-muted-foreground underline-offset-4 transition-colors duration-(--duration-fast) ease-out hover:text-foreground hover:underline'

/** A small footer: the name, the site's pages, legal links and the way in for the team. */
export function SiteFooter({ home }: { home: PublicHome }) {
  const signedIn = useSignedIn()
  return (
    <footer className="border-t border-border">
      <div className={cn(SHELL, 'flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-6')}>
        <p className="text-body-sm text-muted-foreground">
          © {YEAR} {home.appName}
        </p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-6">
            <li>
              <Link to="/about" className={LINK}>
                About
              </Link>
            </li>
            {home.contactEmail && (
              <li>
                <a href={`mailto:${home.contactEmail}`} className={LINK}>
                  Contact
                </a>
              </li>
            )}
            {home.hasPrivacy && (
              <li>
                <Link to="/privacy" className={LINK}>
                  Privacy
                </Link>
              </li>
            )}
            {home.hasTerms && (
              <li>
                <Link to="/terms" className={LINK}>
                  Terms
                </Link>
              </li>
            )}
            <li>
              <Link to={signedIn ? '/dashboard' : '/login'} className={LINK}>
                {signedIn ? 'Dashboard' : 'Team login'}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
