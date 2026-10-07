import { ROLES, type Role, type SessionUser } from '../contracts'
import { MIN_PASSWORD_LENGTH, type AuthErrorCode, type AuthResult, type AuthSource, type AuthState, type PasswordSetupKind, type SignInInput } from './types'

export interface BackendSession {
  userId: string
  email: string
  fullName: string | null
}

export interface BackendError {
  status?: number
  code?: string
  message: string
}

export type BackendEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY'

export interface Membership {
  role: Role
  organization: string
}

/**
 * Operațiile de care are nevoie autentificarea. Implementarea reală (supabase-js) e în `data/supabase/client.ts`;
 * logica de mai jos se testează cu un backend fals, fără rețea.
 */
export interface AuthBackend {
  getSession: () => Promise<BackendSession | null>
  onChange: (cb: (event: BackendEvent, session: BackendSession | null) => void) => () => void
  signInWithPassword: (email: string, password: string) => Promise<BackendError | null>
  signOut: () => Promise<void>
  resetPasswordForEmail: (email: string, redirectTo: string) => Promise<BackendError | null>
  /** `fullName` lipsește la resetarea parolei: numele existent nu se suprascrie. */
  updateUser: (input: { password: string; fullName?: string }) => Promise<BackendError | null>
  /** Rândurile active din `memberships` ale utilizatorului curent (RLS: doar propriile). */
  memberships: () => Promise<Membership[]>
  /** Alege unde se păstrează sesiunea: persistent sau doar în fila curentă. */
  setRemember: (remember: boolean) => void
}

/** Cel mai larg rol câștigă dacă utilizatorul are mai multe membership-uri. */
const PRECEDENCE: readonly Role[] = ['agency_admin', 'strategist', 'account', 'client_viewer']

export function pickMembership(rows: readonly Membership[]): Membership | null {
  const valid = rows.filter((r) => (ROLES as readonly string[]).includes(r.role))
  return [...valid].sort((a, b) => PRECEDENCE.indexOf(a.role) - PRECEDENCE.indexOf(b.role))[0] ?? null
}

function toErrorCode(e: BackendError): AuthErrorCode {
  if (e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit') return 'rate_limited'
  if (e.code === 'invalid_credentials' || e.code === 'user_not_found' || e.status === 400 || e.status === 401) return 'invalid_credentials'
  if (e.code === 'weak_password' || e.status === 422) return 'weak_password'
  if (e.status === undefined || e.status === 0 || e.status >= 500) return 'network'
  return 'unknown'
}

export interface AuthSourceOptions {
  /** Tipul linkului din URL la încărcare (`invite` sau `recovery`), citit înainte ca Supabase să șteargă hash-ul. */
  initialLink?: PasswordSetupKind | null
  /** Unde se întoarce linkul de resetare. */
  redirectTo: string
  /** Apelat după ce parola a fost aleasă, ca să se șteargă parametrii sensibili din URL. */
  onLinkConsumed?: () => void
  /** Linkul din URL era expirat sau invalid: ecranul de login îl anunță o singură dată. */
  initialNotice?: AuthErrorCode | null
}

/** Sesiune reală, peste orice backend care respectă `AuthBackend`. */
export function createAuthSource(backend: AuthBackend, options: AuthSourceOptions): AuthSource {
  let state: AuthState = { status: 'loading' }
  let pending: PasswordSetupKind | null = options.initialLink ?? null
  let session: BackendSession | null = null
  let notice: AuthErrorCode | null = options.initialNotice ?? null
  const listeners = new Set<() => void>()

  function set(next: AuthState) {
    state = next
    listeners.forEach((l) => l())
  }

  async function resolve(s: BackendSession | null): Promise<AuthResult> {
    session = s
    if (!s) {
      set({ status: 'signed_out' })
      return { ok: true }
    }
    if (pending) {
      set({ status: 'password_setup', kind: pending, email: s.email })
      return { ok: true }
    }
    let rows: Membership[]
    try {
      rows = await backend.memberships()
    } catch {
      set({ status: 'signed_out' })
      return { ok: false, code: 'network' }
    }
    const m = pickMembership(rows)
    if (!m) {
      // Fără membership activ (revocat sau neacordat): nu există acces, indiferent de parolă.
      await backend.signOut()
      set({ status: 'signed_out' })
      return { ok: false, code: 'no_access' }
    }
    const user: SessionUser = {
      id: s.userId,
      name: s.fullName?.trim() || s.email.split('@')[0] || s.email,
      email: s.email,
      role: m.role,
      organization: m.organization,
    }
    set({ status: 'signed_in', user })
    return { ok: true }
  }

  backend.onChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') pending = 'recovery'
    if (event === 'SIGNED_OUT') {
      pending = null
      session = null
      set({ status: 'signed_out' })
      return
    }
    // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED: aceeași rezolvare; ignoră reîmprospătări fără schimbare.
    if (event === 'TOKEN_REFRESHED' && state.status === 'signed_in') return
    void resolve(s)
  })

  void backend
    .getSession()
    .then((s) => resolve(s))
    .catch(() => set({ status: 'signed_out' }))

  return {
    getSnapshot: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    consumeNotice() {
      const n = notice
      notice = null
      return n
    },
    async signOut() {
      pending = null
      await backend.signOut()
      set({ status: 'signed_out' })
    },
    async signIn({ email, password, remember }: SignInInput): Promise<AuthResult> {
      backend.setRemember(remember)
      let err: BackendError | null
      try {
        err = await backend.signInWithPassword(email.trim(), password)
      } catch {
        return { ok: false, code: 'network' }
      }
      if (err) return { ok: false, code: toErrorCode(err) }
      return resolve(await backend.getSession())
    },
    async requestPasswordReset(email: string): Promise<AuthResult> {
      let err: BackendError | null
      try {
        err = await backend.resetPasswordForEmail(email.trim(), options.redirectTo)
      } catch {
        return { ok: false, code: 'network' }
      }
      // Același rezultat pentru conturi existente și inexistente: nu confirmăm existența unui cont.
      if (err && (toErrorCode(err) === 'rate_limited' || toErrorCode(err) === 'network')) return { ok: false, code: toErrorCode(err) }
      return { ok: true }
    },
    async completePasswordSetup({ fullName, password }): Promise<AuthResult> {
      if (!session || !pending) return { ok: false, code: 'expired_link' }
      if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: 'weak_password' }
      let err: BackendError | null
      try {
        err = await backend.updateUser({ password, fullName })
      } catch {
        return { ok: false, code: 'network' }
      }
      if (err) return { ok: false, code: err.status === 401 || err.status === 403 ? 'expired_link' : toErrorCode(err) }
      pending = null
      options.onLinkConsumed?.()
      return resolve(await backend.getSession())
    },
  }
}

/** Mediu fără Supabase configurat: nu există sesiune și nu se poate intra. Nu inventează un utilizator. */
export function createUnconfiguredAuth(): AuthSource {
  const state: AuthState = { status: 'signed_out' }
  const unavailable = async (): Promise<AuthResult> => ({ ok: false, code: 'unavailable' })
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    signOut: async () => {},
    consumeNotice: () => null,
    signIn: unavailable,
    requestPasswordReset: unavailable,
    completePasswordSetup: unavailable,
  }
}
