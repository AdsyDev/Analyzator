import type { AuthSource, AuthState } from '../auth/types'
import { ROLES, type Role, type SessionUser } from '../contracts'

const STORAGE_KEY = 'az-preview-session'

/** Utilizatori FICTIVI, câte unul pe rol. Doar pentru previzualizarea de design. */
export const PREVIEW_USERS: Record<Role, SessionUser> = {
  agency_admin: { id: 'preview-admin', name: 'Ioana Popescu', email: 'ioana.popescu@adsymphony.example', role: 'agency_admin', organization: 'AdSymphony' },
  strategist: { id: 'preview-strategist', name: 'Andrei Vasile', email: 'andrei.vasile@adsymphony.example', role: 'strategist', organization: 'AdSymphony' },
  account: { id: 'preview-account', name: 'Maria Ilie', email: 'maria.ilie@adsymphony.example', role: 'account', organization: 'AdSymphony' },
  client_viewer: { id: 'preview-client', name: 'Elena Dobre', email: 'elena.dobre@stada.example', role: 'client_viewer', organization: 'STADA' },
}

function readStored(): Role | 'signed_out' | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY)
    if (v === 'signed_out') return v
    return (ROLES as readonly string[]).includes(v ?? '') ? (v as Role) : null
  } catch {
    return null
  }
}
function store(v: Role | 'signed_out') {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, v)
  } catch {
    // Stocarea poate fi blocată; starea rămâne valabilă cât ține pagina.
  }
}

/** Sesiune fictivă cu rol comutabil (client / agenție). Se păstrează doar în sesiunea browserului. */
export function createPreviewAuth(initial?: Role | 'signed_out'): AuthSource {
  let current: Role | 'signed_out' = initial ?? readStored() ?? 'agency_admin'
  let lastRole: Role = current === 'signed_out' ? 'agency_admin' : current
  const listeners = new Set<() => void>()
  let snapshot: AuthState = toState(current)

  function toState(c: Role | 'signed_out'): AuthState {
    return c === 'signed_out' ? { status: 'signed_out' } : { status: 'signed_in', user: PREVIEW_USERS[c] }
  }
  function set(next: Role | 'signed_out') {
    current = next
    if (next !== 'signed_out') lastRole = next
    snapshot = toState(next)
    store(next)
    listeners.forEach((l) => l())
  }

  const source: AuthSource = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    signOut: async () => set('signed_out'),
    get preview() {
      return { role: lastRole, setRole: (r: Role) => set(r), signIn: (r: Role) => set(r) }
    },
  }
  return source
}
