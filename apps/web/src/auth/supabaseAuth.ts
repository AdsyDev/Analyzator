import type { AuthSource, AuthState } from './types'

const SIGNED_OUT: AuthState = { status: 'signed_out' }

/**
 * Sesiunea Supabase se conectează odată cu ecranul de login (UI-2). Până atunci nu există nicio
 * sesiune: aplicația cere autentificare și nu inventează un utilizator.
 */
export function createSupabaseAuth(): AuthSource {
  return {
    getSnapshot: () => SIGNED_OUT,
    subscribe: () => () => {},
    signOut: async () => {},
  }
}
