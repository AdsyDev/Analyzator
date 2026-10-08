import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthBackend, BackendError, BackendEvent, BackendSession, Membership } from '../../auth/createAuthSource'
import type { AuthErrorCode, PasswordSetupKind } from '../../auth/types'
import type { Role } from '../../contracts'

export const REMEMBER_KEY = 'az-remember'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Sesiunea se păstrează persistent doar dacă utilizatorul a bifat „Ține-mă minte pe acest dispozitiv";
 * altfel, doar cât ține fila. Alegerea însăși e o preferință, nu un secret.
 */
export function rememberableStorage(local: Store, session: Store): Store & { setRemember: (remember: boolean) => void } {
  const remembers = () => local.getItem(REMEMBER_KEY) !== '0'
  return {
    getItem: (k) => session.getItem(k) ?? local.getItem(k),
    setItem: (k, v) => {
      const [target, other] = remembers() ? [local, session] : [session, local]
      target.setItem(k, v)
      other.removeItem(k)
    },
    removeItem: (k) => {
      local.removeItem(k)
      session.removeItem(k)
    },
    setRemember: (remember) => local.setItem(REMEMBER_KEY, remember ? '1' : '0'),
  }
}

export interface UrlLink {
  kind: PasswordSetupKind | null
  notice: AuthErrorCode | null
}

/** Citește tipul linkului din hash (`#access_token=…&type=invite`), înainte ca Supabase să-l consume și să-l șteargă. */
export function readUrlLink(hash: string): UrlLink {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  const type = p.get('type')
  const kind = type === 'invite' || type === 'recovery' ? type : null
  const notice = p.get('error_code') === 'otp_expired' || p.get('error') === 'access_denied' ? 'expired_link' : null
  return { kind, notice }
}

interface UserLike {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}
const toSession = (s: { user: UserLike } | null): BackendSession | null =>
  s ? { userId: s.user.id, email: s.user.email ?? '', fullName: typeof s.user.user_metadata?.full_name === 'string' ? (s.user.user_metadata.full_name as string) : null } : null

const toError = (e: { status?: number; code?: string; message: string } | null): BackendError | null =>
  e ? { status: e.status, code: e.code, message: e.message } : null

/** Adaptorul subțire peste supabase-js. Singurul loc care știe de clientul Supabase pentru autentificare. */
export function createSupabaseBackend(client: SupabaseClient, storage: { setRemember: (r: boolean) => void }): AuthBackend {
  return {
    async getSession() {
      const { data } = await client.auth.getSession()
      return toSession(data.session)
    },
    onChange(cb) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Supabase cere să nu apelezi alte metode ale clientului direct în callback (blocaj): amânăm.
        setTimeout(() => cb(event as BackendEvent, toSession(session)), 0)
      })
      return () => data.subscription.unsubscribe()
    },
    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password })
      return toError(error)
    },
    async signOut() {
      await client.auth.signOut()
    },
    async resetPasswordForEmail(email, redirectTo) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
      return toError(error)
    },
    async updateUser({ password, fullName }) {
      const { error } = await client.auth.updateUser(fullName ? { password, data: { full_name: fullName } } : { password })
      return toError(error)
    },
    async memberships(): Promise<Membership[]> {
      // RLS: utilizatorul vede doar propriile membership-uri; `revoked_at is null` exclude accesul revocat.
      const { data, error } = await client.from('memberships').select('role, tenants(name)').is('revoked_at', null)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as unknown as Array<{ role: Role; tenants: { name: string } | { name: string }[] | null }>
      return rows.map((r) => ({ role: r.role, organization: (Array.isArray(r.tenants) ? r.tenants[0]?.name : r.tenants?.name) ?? '' }))
    },
    setRemember: storage.setRemember,
  }
}

export interface SupabaseAuthSetup {
  backend: AuthBackend
  link: UrlLink
  /** Același client folosește și stratul de date: sesiunea utilizatorului trece prin RLS. */
  client: SupabaseClient
}

/** Cheia `anon` e publică prin design (RLS protejează datele); nu există secrete în frontend. */
export function createBrowserSupabase(url: string, anonKey: string, win: Window = window): SupabaseAuthSetup {
  const link = readUrlLink(win.location.hash)
  const storage = rememberableStorage(win.localStorage, win.sessionStorage)
  const client = createClient(url, anonKey, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  })
  return { backend: createSupabaseBackend(client, storage), link, client }
}
