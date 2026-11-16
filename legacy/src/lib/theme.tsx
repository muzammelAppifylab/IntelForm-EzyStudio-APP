import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

const STORAGE_KEY = 'intelform-theme'
/** The Owner's "light / dark default" (App settings), cached so index.html can apply it before paint. */
const DEFAULT_KEY = 'intelform-theme-default'

/** The member's own choice, or null when they haven't picked one (the app default applies). */
function readStored(key: string): ThemePreference | null {
  try {
    const v = localStorage.getItem(key)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Storage can be blocked (private mode); fall back to the app default.
  }
  return null
}

function systemTheme(): Resolved {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const ThemeContext = createContext<{
  preference: ThemePreference
  resolved: Resolved
  setPreference: (p: ThemePreference) => void
  /** Called with App settings' default mode once it loads. */
  setAppDefault: (p: ThemePreference) => void
} | null>(null)

/** Dark mode is the `.dark` class on <html> (design system rule). index.html applies it before paint. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<ThemePreference | null>(() => readStored(STORAGE_KEY))
  const [appDefault, setAppDefaultState] = useState<ThemePreference>(() => readStored(DEFAULT_KEY) ?? 'system')
  const [system, setSystem] = useState<Resolved>(systemTheme)
  const preference = chosen ?? appDefault
  const resolved = preference === 'system' ? system : preference

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setPreference = useCallback((p: ThemePreference) => {
    setChosen(p)
    try {
      localStorage.setItem(STORAGE_KEY, p)
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [])

  const setAppDefault = useCallback((p: ThemePreference) => {
    setAppDefaultState(p)
    try {
      localStorage.setItem(DEFAULT_KEY, p)
    } catch {
      // Not cached; it still applies once the app info loads.
    }
  }, [])

  return <ThemeContext value={{ preference, resolved, setPreference, setAppDefault }}>{children}</ThemeContext>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
