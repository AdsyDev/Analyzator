import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/** Rutele din spatele autentificării. Fără sesiune: spre `/login`, cu adresa cerută păstrată pentru întoarcere. */
export function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') {
    return <div role="status" aria-label="Se verifică sesiunea" className="grid min-h-screen place-items-center text-[13px] text-text-2">Se verifică sesiunea…</div>
  }
  if (state.status === 'signed_out') {
    return <Navigate to="/login" replace state={{ from: { pathname: location.pathname, search: location.search } }} />
  }
  return <Outlet />
}
