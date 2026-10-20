import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FeaturedFormView, FrontPageContent } from '@shared/api-front'
import { appInfoQuery } from '@/lib/auth'
import { previewHome } from '@/pages/dashboard/front-page/preview-data'
import { HomeView } from '@/pages/public/home/HomeView'
import { homePreset, loadPresetFonts } from '@/pages/public/home/theme'

/** Width the page is laid out at before scaling into the panel. */
const FRAME_WIDTH = 1200

/** Live preview: the real home components at desktop width, scaled to fit, not interactive. */
export function Preview({ content, featured }: { content: FrontPageContent; featured: FeaturedFormView[] }) {
  const { data: app } = useQuery(appInfoQuery)
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 0.5, height: 600 })

  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const measure = () => {
      const scale = o.clientWidth / FRAME_WIDTH
      setBox({ scale, height: i.offsetHeight * scale })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [])

  useEffect(() => loadPresetFonts(homePreset(content.themeId)), [content.themeId])

  const home = previewHome(content, featured, { appName: app?.appName ?? '', logoUrl: app?.logoUrl ?? null })
  return (
    <div ref={outer} className="relative overflow-hidden rounded-lg border border-border bg-card" style={{ height: box.height }}>
      <div
        ref={inner}
        inert
        aria-hidden
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: FRAME_WIDTH, transform: `scale(${box.scale})` }}
      >
        <HomeView home={home} />
      </div>
    </div>
  )
}
