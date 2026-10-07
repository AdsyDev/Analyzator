import { useEffect } from 'react'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import { DataProvidersProvider } from './data/DataProvidersContext'
import type { AppEnvironment } from './environment'
import { BANNER_HEIGHT, PreviewBanner } from './preview/PreviewBanner'
import { AppRoutes } from './routing/AppRoutes'
import { Aurora } from './theme/Aurora'
import { ThemeProvider } from './theme/ThemeProvider'

/** Aplicația fără router (îl pune `main`, sau testele cu MemoryRouter). */
export function App({ env }: { env: AppEnvironment }) {
  useEffect(() => {
    if (!__DESIGN_PREVIEW__) return
    document.documentElement.style.setProperty('--banner-h', BANNER_HEIGHT)
    return () => {
      document.documentElement.style.removeProperty('--banner-h')
    }
  }, [])

  return (
    <ThemeProvider>
      <AuthProvider source={env.auth}>
        <DataProvidersProvider providers={env.providers}>
          <ToastProvider>
            <Aurora />
            {/* Bannerul stă în afara rutelor ca să fie vizibil pe orice ecran, inclusiv login. */}
            {__DESIGN_PREVIEW__ && (
              <div className="fixed inset-x-0 top-0 z-[70]">
                <PreviewBanner />
              </div>
            )}
            <AppRoutes />
          </ToastProvider>
        </DataProvidersProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
