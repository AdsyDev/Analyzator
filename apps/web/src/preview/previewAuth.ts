import { MIN_PASSWORD_LENGTH, type AuthResult, type AuthSource, type AuthState } from '../auth/types'
import { ROLES, type Role, type SessionUser } from '../contracts'

const STORAGE_KEY = 'az-preview-session'

/** Utilizatori FICTIVI, câte unul pe rol. Doar pentru previzualizarea de design. */
export const PREVIEW_USERS: Record<Role, SessionUser> = {
  agency_admin: { id: 'preview-admin', name: 'Ioana Popescu', email: 'ioana.popescu@adsymphony.example', role: 'agency_admin', organization: 'AdSymphony' },
  strategist: { id: 'preview-strategist', name: 'Andrei Vasile', email: 'andrei.vasile@adsymphony.example', role: 'strategist', organization: 'AdSymphony' },
  account: { id: 'preview-account', name: 'Maria Ilie', email: 'maria.ilie@adsymphony.example', role: 'account', organization: 'AdSymphony' },
  client_viewer: { id: 'preview-client', name: 'Elena Dobre', email: 'elena.dobre@stada.example', role: 'client_viewer', organization: 'STADA' },
}

/** Adresa fictivă a invitației din previzualizare. */
export const PREVIEW_INVITE_EMAIL = PREVIEW_USERS.client_viewer.email

type Stored = Role | 'signed_out'

function readStored(): Stored | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY)
    if (v === 'signed_out') return v
    return (ROLES as readonly string[]).includes(v ?? '') ? (v as Role) : null
  } catch {
    return null
  }
}
function store(v: Stored) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, v)
  } catch {
    // Stocarea poate fi blocată; starea rămâne valabilă cât ține pagina.
  }
}

/**
 * Sesiune fictivă cu rol comutabil (client / agenție). Formularul de login acceptă adresele fictive din
 * `PREVIEW_USERS` cu orice parolă; nu trimite nimic nicăieri. Se păstrează doar în sesiunea browserului.
 */
export function createPreviewAuth(initial?: Stored): AuthSource {
  let current: Stored = initial ?? readStored() ?? 'agency_admin'
  let lastRole: Role = current === 'signed_out' ? 'agency_admin' : current
  const listeners = new Set<() => void>()

  const toState = (c: Stored): AuthState => (c === 'signed_out' ? { status: 'signed_out' } : { status: 'signed_in', user: PREVIEW_USERS[c] })
  let snapshot: AuthState = toState(current)

  function emit(next: AuthState) {
    snapshot = next
    listeners.forEach((l) => l())
  }
  function set(next: Stored) {
    current = next
    if (next !== 'signed_out') lastRole = next
    store(next)
    emit(toState(next))
  }

  const source: AuthSource = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    consumeNotice: () => null,
    signOut: async () => set('signed_out'),
    async signIn({ email, password }): Promise<AuthResult> {
      const user = Object.values(PREVIEW_USERS).find((u) => u.email === email.trim().toLowerCase())
      if (!user || !password) return { ok: false, code: 'invalid_credentials' }
      set(user.role)
      return { ok: true }
    },
    async requestPasswordReset(): Promise<AuthResult> {
      return { ok: true }
    },
    async completePasswordSetup({ password }): Promise<AuthResult> {
      if (snapshot.status !== 'password_setup') return { ok: false, code: 'expired_link' }
      if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: 'weak_password' }
      set('client_viewer')
      return { ok: true }
    },
    get preview() {
      return {
        role: lastRole,
        setRole: (r: Role) => set(r),
        signIn: (r: Role) => set(r),
        startInvite: () => emit({ status: 'password_setup', kind: 'invite', email: PREVIEW_INVITE_EMAIL }),
      }
    },
  }
  return source
}
