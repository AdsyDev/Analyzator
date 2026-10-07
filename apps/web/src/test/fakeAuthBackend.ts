import type { AuthBackend, BackendError, BackendEvent, BackendSession, Membership } from '../auth/createAuthSource'

/** Backend fals pentru testele de autentificare: fără rețea, cu apelurile înregistrate. */
export function fakeAuthBackend(init: { session?: BackendSession | null; memberships?: Membership[] } = {}) {
  let session: BackendSession | null = init.session ?? null
  let handler: ((e: BackendEvent, s: BackendSession | null) => void) | null = null
  const calls: Array<[string, ...unknown[]]> = []

  const api = {
    memberships: init.memberships ?? ([] as Membership[]),
    signInError: null as BackendError | null,
    signInThrows: false,
    resetError: null as BackendError | null,
    updateError: null as BackendError | null,
    membershipsThrows: false,
    sessionAfterSignIn: null as BackendSession | null,
    calls,
    emit: (e: BackendEvent, s: BackendSession | null) => handler?.(e, s),
    setSession: (s: BackendSession | null) => {
      session = s
    },
  }

  const backend: AuthBackend = {
    getSession: async () => session,
    onChange: (cb) => {
      handler = cb
      return () => {
        handler = null
      }
    },
    signInWithPassword: async (email, password) => {
      calls.push(['signIn', email, password])
      if (api.signInThrows) throw new Error('rețea')
      if (api.signInError) return api.signInError
      session = api.sessionAfterSignIn ?? { userId: 'u1', email, fullName: null }
      return null
    },
    signOut: async () => {
      calls.push(['signOut'])
      session = null
    },
    resetPasswordForEmail: async (email, redirectTo) => {
      calls.push(['reset', email, redirectTo])
      return api.resetError
    },
    updateUser: async (input) => {
      calls.push(['update', input])
      return api.updateError
    },
    memberships: async () => {
      if (api.membershipsThrows) throw new Error('rețea')
      return api.memberships
    },
    setRemember: (r) => {
      calls.push(['remember', r])
    },
  }
  return { backend, api }
}

export const flush = () => new Promise<void>((r) => setTimeout(r, 0))
