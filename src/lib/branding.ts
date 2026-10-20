import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { contrastRatio } from '@shared/form/theme'
import { appInfoQuery } from './auth'
import { useTheme } from './theme'

const ACCENT_VARS = ['--primary', '--primary-hover', '--primary-foreground', '--ring', '--sidebar-accent', '--sidebar-accent-foreground'] as const

/** palette ink-950 (styles.css), as a hex for the contrast check. */
const INK = '#211D2A'

/**
 * Applies App settings branding: the favicon everywhere, and (when `accent` is set) the
 * dashboard accent colour over the design system's primary and the active nav fill. Text on the
 * accent picks white or ink, whichever contrasts more. The 2px ink edges stay ink. The light / dark
 * default applies to members who haven't picked a mode themselves.
 */
export function useBranding({ accent }: { accent: boolean }) {
  const { data: app } = useQuery(appInfoQuery)
  const { setAppDefault } = useTheme()

  useEffect(() => {
    if (app?.defaultMode) setAppDefault(app.defaultMode)
  }, [app?.defaultMode, setAppDefault])

  useEffect(() => {
    if (!app?.faviconUrl) return
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    const previous = link.href
    link.href = app.faviconUrl
    link.removeAttribute('type')
    return () => {
      link.href = previous
    }
  }, [app?.faviconUrl])

  useEffect(() => {
    const color = accent ? app?.accentColor : null
    if (!color) return
    const root = document.documentElement.style
    const onAccent = contrastRatio(color, '#FFFFFF') >= contrastRatio(color, INK) ? '#FFFFFF' : 'var(--palette-ink-950)'
    root.setProperty('--primary', color)
    root.setProperty('--primary-hover', `color-mix(in oklab, ${color} 85%, var(--palette-ink-950))`)
    root.setProperty('--primary-foreground', onAccent)
    root.setProperty('--ring', color)
    root.setProperty('--sidebar-accent', color)
    root.setProperty('--sidebar-accent-foreground', onAccent)
    return () => ACCENT_VARS.forEach((v) => root.removeProperty(v))
  }, [accent, app?.accentColor])
}
