import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import type { LegalKind, PublicLegal } from '@shared/api-front'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { api } from '@/lib/api'
import { PlainText } from '@/pages/public/home/PlainText'

/** Privacy and Terms: plain text edited in the dashboard (Front page editor), one paragraph per blank line. */
export default function LegalPage() {
  const kind: LegalKind = useLocation().pathname === '/privacy' ? 'privacy' : 'terms'
  const legal = useQuery({ queryKey: ['public-legal', kind], queryFn: () => api<PublicLegal>(`/api/public/legal/${kind}`) })
  if (legal.isPending) return <FullPageSpinner />
  const title = legal.data?.title ?? (kind === 'privacy' ? 'Privacy policy' : 'Terms')
  const appName = legal.data?.appName
  return (
    <div className="min-h-dvh bg-background">
      <main id="main" className="mx-auto grid max-w-(--form-width) gap-8 px-4 py-12 sm:py-16">
        <title>{appName ? `${title} · ${appName}` : title}</title>
        <Link to="/" className="focus-ring inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-sm text-label text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          {appName ? `Back to ${appName}` : 'Back to the home page'}
        </Link>
        <h1 className="text-title">{title}</h1>
        {legal.isError ? (
          <p className="text-body text-muted-foreground">This page didn’t load. Refresh to try again.</p>
        ) : legal.data.text ? (
          <PlainText text={legal.data.text} className="text-body text-foreground" />
        ) : (
          <p className="text-body text-muted-foreground">This page hasn’t been written yet.</p>
        )}
      </main>
    </div>
  )
}
