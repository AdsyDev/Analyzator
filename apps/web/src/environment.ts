import { createSupabaseAuth } from './auth/supabaseAuth'
import type { AuthSource } from './auth/types'
import type { DataProviders } from './contracts'
import { createSupabaseProviders } from './data/supabase/providers'

export interface AppEnvironment {
  providers: DataProviders
  auth: AuthSource
}

/**
 * Singurul punct în care se aleg providerii de date și sursa sesiunii. `__DESIGN_PREVIEW__` e
 * constantă la build (vite.config.ts): fără flag, ramura și importul dinamic dispar din bundle, deci
 * fixtures și utilizatorul fictiv nu ajung în producție sau staging.
 */
export function createEnvironment(): Promise<AppEnvironment> {
  if (__DESIGN_PREVIEW__) {
    return import('./preview/environment').then((m) => m.createPreviewEnvironment())
  }
  return Promise.resolve({ providers: createSupabaseProviders(), auth: createSupabaseAuth() })
}
