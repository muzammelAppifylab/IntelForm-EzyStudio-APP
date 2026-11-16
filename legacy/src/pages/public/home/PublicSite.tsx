import { useQuery } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import type { PublicHome } from '@shared/api-front'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { publicHomeQuery, usePresetScheme } from './site'
import { SITE_PRESET, loadPresetFonts } from './theme'

/**
 * Loads what every public site page needs (app name, logo, listed forms, search and legal
 * flags) and applies the site's theme. It never mentions the tool, signup or pricing.
 */
export function PublicSite({ children }: { children: (home: PublicHome) => ReactNode }) {
  const home = useQuery(publicHomeQuery)
  usePresetScheme(SITE_PRESET.mode)
  useEffect(() => loadPresetFonts(SITE_PRESET), [])
  if (home.isPending) return <FullPageSpinner />
  if (home.isError) return <LoadError />
  return (
    <>
      {!home.data.indexing && <meta name="robots" content="noindex" />}
      {children(home.data)}
    </>
  )
}

export function LoadError() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-(--form-width) place-content-center gap-2 px-4 text-center">
      <title>Something went wrong</title>
      <h1 className="text-title">This page didn’t load</h1>
      <p className="text-body text-muted-foreground">Refresh the page to try again.</p>
    </main>
  )
}
