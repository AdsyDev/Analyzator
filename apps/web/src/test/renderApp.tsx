import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, vi } from 'vitest'
import { App } from '../App'
import type { AuthSource } from '../auth/types'
import type { DataProviders, Role } from '../contracts'
import { createFixtureProviders } from '../data/fixtures/createFixtureProviders'
import { createPreviewAuth } from '../preview/previewAuth'

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

export interface RenderOpts {
  role?: Role
  route: string
  wrap?: (base: DataProviders) => DataProviders
}

/** Randează aplicația întreagă cu fixtures (și, opțional, provideri modificați) pe o rută. */
export function renderApp({ role = 'agency_admin', route, wrap }: RenderOpts) {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  document.documentElement.removeAttribute('data-az-theme')
  const auth: AuthSource = createPreviewAuth(role)
  const base = createFixtureProviders({ getRole: () => auth.preview?.role ?? role })
  const providers = wrap ? wrap(base) : base
  render(
    <MemoryRouter initialEntries={[route]}>
      <App env={{ providers, auth }} />
      <Where />
    </MemoryRouter>,
  )
  return { providers, auth }
}

export const where = () => screen.getByTestId('where').textContent
export const pageReady = async (title: string) => {
  await screen.findByRole('heading', { level: 1, name: title })
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Se încarcă/ })).toHaveLength(0), { timeout: 4000 })
}
