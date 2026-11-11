export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'az-theme'
export const THEME_ATTRIBUTE = 'data-az-theme'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

export function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Stocarea poate fi blocată; tema rămâne valabilă pentru sesiune.
  }
}

/**
 * Tema cu care pornește aplicația când utilizatorul nu a ales una: închisă, ca în macheta din propunere
 * („Imaginea completă a brandului”). Nu mai urmează tema sistemului; butonul din bara de sus o schimbă și o reține.
 */
export const DEFAULT_THEME: Theme = 'dark'

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
}
