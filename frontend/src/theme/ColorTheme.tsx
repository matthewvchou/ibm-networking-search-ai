import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** The two Carbon themes this app ships: g10 (light) and g100 (dark). */
export type ColorTheme = 'g10' | 'g100'

export const THEME_STORAGE_KEY = 'ibm-directory-theme'

/** Carbon emits one "zone" class per theme (`.cds--g10`, `.cds--g100`) that redefines
 *  every `--cds-*` token. `<Theme>` puts it on a wrapper div; we also put it on <html>
 *  so the page background and anything portalled to <body> (tooltips, modals) match. */
const ZONE_CLASS: Record<ColorTheme, string> = { g10: 'cds--g10', g100: 'cds--g100' }

/** localStorage access throws outright in some privacy modes, so every read/write is guarded. */
function storedTheme(): ColorTheme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'g10' || value === 'g100' ? value : null
  } catch {
    return null
  }
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

type ColorThemeValue = {
  theme: ColorTheme
  isDark: boolean
  toggleTheme: () => void
}

const ColorThemeContext = createContext<ColorThemeValue | null>(null)

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ColorTheme>(() => storedTheme() ?? (prefersDark() ? 'g100' : 'g10'))

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove(ZONE_CLASS.g10, ZONE_CLASS.g100)
    root.classList.add(ZONE_CLASS[theme])
  }, [theme])

  // Follow the OS setting, but only until the user has made a choice of their own —
  // an explicit toggle is what writes to storage, and it wins from then on.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    function handleChange(event: MediaQueryListEvent) {
      if (!storedTheme()) setTheme(event.matches ? 'g100' : 'g10')
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((previous) => {
      const next: ColorTheme = previous === 'g10' ? 'g100' : 'g10'
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // Preference just doesn't persist; the toggle still works for this session.
      }
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, isDark: theme === 'g100', toggleTheme }), [theme, toggleTheme])

  return <ColorThemeContext.Provider value={value}>{children}</ColorThemeContext.Provider>
}

export function useColorTheme(): ColorThemeValue {
  const value = useContext(ColorThemeContext)
  if (!value) throw new Error('useColorTheme must be used inside a ColorThemeProvider')
  return value
}
