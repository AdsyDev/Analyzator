import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { SessionUser } from '../contracts'
import type { AuthSource, AuthState, PreviewAuthControls } from './types'

const AuthContext = createContext<AuthSource | null>(null)

export function AuthProvider({ source, children }: { source: AuthSource; children: ReactNode }) {
  return <AuthContext.Provider value={source}>{children}</AuthContext.Provider>
}

export function useAuth(): { state: AuthState; signOut: () => Promise<void>; preview: PreviewAuthControls | undefined; source: AuthSource } {
  const source = useContext(AuthContext)
  if (!source) throw new Error('useAuth se folosește în interiorul AuthProvider')
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  return { state, signOut: source.signOut, preview: source.preview, source }
}

/** Utilizatorul curent, pentru ecranele din spatele `RequireAuth`. Aruncă dacă nu există sesiune. */
export function useUser(): SessionUser {
  const { state } = useAuth()
  if (state.status !== 'signed_in') throw new Error('useUser se folosește doar pentru o sesiune activă')
  return state.user
}
