import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate } from 'react-router'
import type { PublicHome, PublicHomeOn } from '@shared/api-front'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { api } from '@/lib/api'
import { HomeView } from '@/pages/public/home/HomeView'
import { homePreset, loadPresetFonts } from '@/pages/public/home/theme'

const publicHomeQuery = { queryKey: ['public-home'], queryFn: () => api<PublicHome>('/api/public/home') }

/**
 * The creator's forms hub at /. When the front page is off, / sends visitors to the login
 * screen. It never mentions the tool, signup or pricing.
 */
export default function HomePage() {
  const home = useQuery(publicHomeQuery)
  if (home.isPending) return <FullPageSpinner />
  if (home.isError) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-(--form-width) place-content-center gap-2 px-4 text-center">
        <title>Something went wrong</title>
        <h1 className="text-title">This page didn’t load</h1>
        <p className="text-body text-muted-foreground">Refresh the page to try again.</p>
      </main>
    )
  }
  if (!home.data.enabled) return <Navigate to="/login" replace />
  return <PublicHomePage home={home.data} />
}

function PublicHomePage({ home }: { home: PublicHomeOn }) {
  const preset = homePreset(home.themeId)
  usePresetScheme(preset.mode)
  useEffect(() => loadPresetFonts(preset), [preset])

  const title = home.seo.title || home.hero.headline || home.appName
  const description = home.seo.description || home.hero.text.slice(0, 160)
  const ogImage = home.seo.ogImage ? new URL(home.seo.ogImage, location.origin).href : null
  return (
    <>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={location.origin + '/'} />
      <meta property="og:site_name" content={home.appName} />
      {ogImage && <meta property="og:image" content={ogImage} />}
      <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
      {!home.seo.indexing && <meta name="robots" content="noindex" />}
      <HomeView home={home} className="min-h-dvh" />
    </>
  )
}

/**
 * The page follows its preset, not the visitor's light/dark setting: the tokens the preset
 * doesn't set (status colours) must match it. Restored on the way out.
 */
function usePresetScheme(mode: 'light' | 'dark') {
  useEffect(() => {
    const root = document.documentElement
    const was = root.classList.contains('dark')
    root.classList.toggle('dark', mode === 'dark')
    return () => {
      root.classList.toggle('dark', was)
    }
  }, [mode])
}
