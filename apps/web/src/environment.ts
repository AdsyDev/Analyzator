import { createAuthSource, createUnconfiguredAuth } from './auth/createAuthSource'
import type { AuthSource } from './auth/types'
import type { DataProviders } from './contracts'
import { createSupabaseProviders } from './data/supabase/providers'

export interface AppEnvironment {
  providers: DataProviders
  auth: AuthSource
}

interface RealSetup {
  auth: AuthSource
  providers: DataProviders
}

async function createRealSetup(): Promise<RealSetup> {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return { auth: createUnconfiguredAuth(), providers: createSupabaseProviders() }
  const { createBrowserSupabase } = await import('./data/supabase/client')
  const { backend, link, client } = createBrowserSupabase(url, key)
  const auth = createAuthSource(backend, {
    initialLink: link.kind,
    initialNotice: link.notice,
    redirectTo: `${window.location.origin}/login`,
    // După alegerea parolei, tokenurile rămân în hash: le ștergem din URL.
    onLinkConsumed: () => window.history.replaceState(null, '', window.location.pathname + window.location.search),
  })
  return { auth, providers: createSupabaseProviders({ client }) }
}

/**
 * Singurul punct în care se aleg providerii de date și sursa sesiunii. `__DESIGN_PREVIEW__` e
 * constantă la build (vite.config.ts): fără flag, ramura și importul dinamic dispar din bundle, deci
 * fixtures și utilizatorul fictiv nu ajung în producție sau staging.
 */
export async function createEnvironment(): Promise<AppEnvironment> {
  if (__DESIGN_PREVIEW__) {
    return import('./preview/environment').then((m) => m.createPreviewEnvironment())
  }
  return createRealSetup()
}
