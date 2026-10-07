import type { Role, SessionUser } from '../contracts'

export type AuthState = { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; user: SessionUser }

/** Doar în previzualizare: utilizator fictiv cu rol comutabil. Absent în orice build fără flag. */
export interface PreviewAuthControls {
  role: Role
  setRole: (role: Role) => void
  signIn: (role: Role) => void
}

/**
 * Sursa sesiunii. Autentificarea reală vine din Supabase (acces pe invitație, fără signup);
 * UI-ul nu decide singur accesul: RLS rămâne autoritatea, iar gardurile din rute sunt doar comoditate.
 */
export interface AuthSource {
  getSnapshot: () => AuthState
  subscribe: (listener: () => void) => () => void
  signOut: () => Promise<void>
  preview?: PreviewAuthControls
}
