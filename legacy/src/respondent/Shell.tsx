import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { themeToVars, type FormTheme } from '@shared/form/theme-core'
import { clsx } from 'clsx'
import { loadThemeFonts } from './fonts'

export type ShellMode = 'page' | 'embed' | 'preview'

/**
 * The themed root (`.form-theme` + themeToVars inline): background colour or image with its
 * darken overlay, the logo, and a size container so the layouts use container queries (they
 * work the same inside the builder preview as on a phone). `page` fills the dynamic viewport;
 * `embed` takes its content height (the parent iframe resizes to it); `preview` fills its parent.
 */
export function FormShell({
  theme,
  mode,
  transparent,
  device,
  children,
  className,
}: {
  theme: FormTheme
  mode: ShellMode
  transparent?: boolean
  device?: 'desktop' | 'mobile'
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => loadThemeFonts(theme), [theme])
  useKeyboardInset(ref, mode === 'page')
  // --destructive (danger-700 in light mode, for 4.5:1 error text) is set on .form-theme in src/styles/form-theme.css.
  const vars = themeToVars(theme) as CSSProperties
  const image = theme.background.type === 'image' && !transparent
  const logo = theme.logo
  return (
    <div
      ref={ref}
      data-mode={mode}
      style={vars}
      className={clsx(
        'form-theme @container relative isolate flex min-w-0 flex-col text-foreground',
        mode === 'page' && 'min-h-dvh',
        mode === 'preview' && 'h-full min-h-full overflow-y-auto',
        mode === 'preview' && device === 'mobile' && 'mx-auto w-full max-w-[26rem]',
        transparent && 'bg-transparent',
        className,
      )}
    >
      {image && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: 'var(--form-bg-image)' }} />
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-ink-950" style={{ opacity: 'var(--form-bg-overlay)' }} />
        </>
      )}
      {logo && (
        <div className={clsx('flex px-4 pt-6 @lg:px-8', logo.position === 'center' ? 'justify-center' : 'justify-start')}>
          <img src={logo.url} alt={logo.alt ?? ''} className="h-10 w-auto max-w-48 object-contain" />
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * On-screen keyboards: `--kb` is how much of the layout viewport the keyboard covers (iOS doesn't
 * resize the layout viewport), so fixed controls can sit above it. Focused inputs scroll to the
 * middle on touch devices.
 */
function useKeyboardInset(ref: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const vv = window.visualViewport
    const el = ref.current
    if (!on || !vv || !el) return
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      el.style.setProperty('--kb', `${Math.round(inset)}px`)
    }
    const coarse = matchMedia('(pointer: coarse)').matches
    let timer: number | undefined
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      if (!coarse || !t.matches('input, textarea, select')) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => t.scrollIntoView({ block: 'center' }), 300)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    el.addEventListener('focusin', onFocus)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      el.removeEventListener('focusin', onFocus)
      window.clearTimeout(timer)
    }
  }, [ref, on])
}
