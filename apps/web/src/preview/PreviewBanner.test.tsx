import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvironment } from '../environment'
import { PreviewBanner } from './PreviewBanner'

describe('PreviewBanner', () => {
  it('afișează textul cerut și nu poate fi închis', () => {
    render(<PreviewBanner />)
    expect(screen.getByRole('note')).toHaveTextContent('Previzualizare design — date fictive')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('createEnvironment', () => {
  // Fără configurare Supabase, indiferent de `.env.local` al dezvoltatorului: testul verifică doar alegerea providerului.
  afterEach(() => vi.unstubAllEnvs())

  it('fără flag la build, alege providerul supabase și nicio sesiune fictivă', async () => {
    expect(__DESIGN_PREVIEW__).toBe(false)
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const env = await createEnvironment()
    expect(env.providers.kind).toBe('supabase')
    expect(env.auth.getSnapshot()).toEqual({ status: 'signed_out' })
    expect(env.auth.preview).toBeUndefined()
  })
})
