import type { AppEnvironment } from '../environment'
import { createFixtureProviders } from '../data/fixtures/createFixtureProviders'
import { createPreviewAuth, PREVIEW_USERS } from './previewAuth'
import type { Role } from '../contracts'

/** Mediul de previzualizare: fixtures fictive + sesiune fictivă. Se încarcă doar cu VITE_DESIGN_PREVIEW=true. */
export function createPreviewEnvironment(): AppEnvironment {
  const auth = createPreviewAuth()
  const role = (): Role => auth.preview?.role ?? 'agency_admin'
  const providers = createFixtureProviders({ getRole: role, getUser: () => PREVIEW_USERS[role()] })
  return { providers, auth }
}
