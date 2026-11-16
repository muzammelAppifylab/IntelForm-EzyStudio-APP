import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import type { LegalKind, PublicLegal } from '@shared/api-front'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { api } from '@/lib/api'
import { PlainText } from '@/pages/public/home/PlainText'
import { PublicSite } from '@/pages/public/home/PublicSite'
import { PageIntro } from '@/pages/public/home/sections'
import { SHELL } from '@/pages/public/home/site'
import { SiteFrame } from '@/pages/public/home/SiteFrame'

/**
 * Privacy and Terms: plain text from Settings → Public site, one paragraph per blank line, inside
 * the site's menu and footer.
 */
export default function LegalPage() {
  const kind: LegalKind = useLocation().pathname === '/privacy' ? 'privacy' : 'terms'
  const legal = useQuery({ queryKey: ['public-legal', kind], queryFn: () => api<PublicLegal>(`/api/public/legal/${kind}`) })
  if (legal.isPending) return <FullPageSpinner />
  const title = legal.data?.title ?? (kind === 'privacy' ? 'Privacy policy' : 'Terms')
  const body = legal.isError ? (
    <p className="text-body text-muted-foreground">This page didn’t load. Refresh to try again.</p>
  ) : legal.data.text ? (
    <PlainText text={legal.data.text} className="text-body text-foreground" />
  ) : (
    <p className="text-body text-muted-foreground">This page hasn’t been written yet.</p>
  )

  return (
    <PublicSite>
      {(home) => (
        <SiteFrame home={home} current="legal">
          <title>{`${title} · ${home.appName}`}</title>
          <PageIntro eyebrow="Legal" title={title} />
          <section aria-label={title} className={SHELL}>
            <div className="max-w-[65ch] border-t-2 border-border-ink pt-10">{body}</div>
          </section>
        </SiteFrame>
      )}
    </PublicSite>
  )
}
