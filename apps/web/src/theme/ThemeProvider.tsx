import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, DEFAULT_THEME, readStoredTheme, storeTheme, type Theme } from './theme'

interface ThemeContextValue {
  theme: Theme
  /** `true` dacă utilizatorul a ales explicit tema; altfel e tema implicită (închisă). */
  explicit: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Theme | null>(() => readStoredTheme())
  const theme = stored ?? DEFAULT_THEME

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setStored(next)
  }, [])

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])

  const value = useMemo(
    () => ({ theme, explicit: stored !== null, setTheme, toggleTheme }),
    [theme, stored, setTheme, toggleTheme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme se folosește în interiorul ThemeProvider')
  return ctx
}
