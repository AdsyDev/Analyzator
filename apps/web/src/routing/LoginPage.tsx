import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/Button'

interface FromState {
  from?: { pathname?: string; search?: string }
}

/** Întoarcerea se face doar la adrese interne, din starea routerului (niciodată dintr-un parametru de URL). */
function safeFrom(state: unknown): string {
  const from = (state as FromState | null)?.from
  const path = from?.pathname
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path === '/login') return '/'
  return `${path}${typeof from?.search === 'string' ? from.search : ''}`
}

/**
 * Ecranul de autentificare pe invitație (fără signup) se construiește în UI-2. Aici: poarta spre aplicație.
 * În previzualizare, două intrări fictive (agenție, client) ca să poată fi văzute ambele vederi.
 */
export function LoginPage() {
  const { state, preview } = useAuth()
  const location = useLocation()
  if (state.status === 'signed_in') return <Navigate to={safeFrom(location.state)} replace />

  return (
    <main className="relative z-10 grid min-h-screen place-items-center px-4">
      <div className="glass-strong w-[min(420px,100%)] rounded-2xl p-8">
        <div className="mb-5 flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-[30px] place-items-center rounded-[9px] bg-accent-btn font-display text-[15px] font-bold text-on-accent">A</span>
          <span className="font-display text-[16px] font-semibold">Analyzator</span>
          <span className="text-[13px] text-text-2">de AdSymphony</span>
        </div>
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em]">Autentificare</h1>
        <p className="mt-2 text-[13.5px] leading-normal text-text-2">Accesul se face doar pe bază de invitație. Nu există înregistrare publică.</p>
        {preview ? (
          <div className="mt-5 flex flex-col gap-2">
            <p className="text-[12.5px] text-text-2">Previzualizare: alege vederea.</p>
            <Button variant="primary" onClick={() => preview.signIn('agency_admin')}>Intră ca agenție (administrator)</Button>
            <Button onClick={() => preview.signIn('client_viewer')}>Intră ca client</Button>
          </div>
        ) : (
          <p className="mt-5 rounded-lg bg-neutral-soft px-3 py-2 text-[13px] text-text-2">Autentificarea pe invitație nu este încă disponibilă în această versiune.</p>
        )}
      </div>
    </main>
  )
}
