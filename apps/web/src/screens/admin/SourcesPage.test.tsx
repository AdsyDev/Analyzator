import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseSources } from '../../data/supabase/sourcesProvider'
import { fakeDataClient } from '../../test/fakeDataClient'
import { pageReady, renderApp, where } from '../../test/renderApp'

const URL = '/admin/sources'
const useBrand = (id: string) => window.sessionStorage.setItem('az-brand', id)
const article = (name: RegExp | string) => screen.findByRole('article', { name })

describe('Administrare → Surse (fixtures de previzualizare)', () => {
  it('grila are cele 6 surse din spec, cu starea fiecăreia', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const grid = (await screen.findByRole('heading', { level: 2, name: 'Starea surselor' })).closest('section')!
    const states = await within(grid).findAllByRole('article')
    expect(states.map((a) => [a.getAttribute('aria-label'), a.getAttribute('data-state')])).toEqual([
      ['SEOmonitor', 'partial'],
      ['Google Analytics 4', 'connected'],
      ['Search Console', 'stale'],
      ['Microsoft Clarity', 'error'],
      ['Planable', 'not_connected'],
      ['Import CSV', 'not_connected'],
    ])
  })

  it('conexiunea arată starea credențialului și bugetul, cu textul obligatoriu', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Conexiune Microsoft Clarity · urinal.example')
    expect(within(card).getByText('Token refuzat de furnizor')).toBeInTheDocument()
    expect(within(card).getByText('Testarea consumă 1 din cele 10 apeluri zilnice. Azi: 3 folosite.')).toBeInTheDocument()
  })

  it('testul consumă bugetul și actualizează „Azi: X folosite" și starea', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Conexiune Microsoft Clarity · urinal.example')
    await userEvent.click(within(card).getByRole('button', { name: 'Testează conexiunea' }))
    expect(await within(card).findByText('Conexiunea funcționează.')).toBeInTheDocument()
    expect(within(card).getByText('Testarea consumă 1 din cele 10 apeluri zilnice. Azi: 4 folosite.')).toBeInTheDocument()
    expect(within(card).getAllByText('Conexiune funcțională').length).toBeGreaterThan(0)
  })

  it('bugetul consumat dezactivează testul și explică resetarea', async () => {
    useBrand('brand-minimartieni')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article(/Conexiune Microsoft Clarity/)
    expect(within(card).getByRole('button', { name: 'Testează conexiunea' })).toBeDisabled()
    expect(within(card).getByText(/Azi: 10 folosite/)).toBeInTheDocument()
    expect(within(card).getByText(/Se resetează la 00:00 UTC \(03:00 ora României vara, 02:00 iarna\)/)).toBeInTheDocument()
  })

  it('tokenul: câmp parolă, golit după salvare, niciodată afișat; mesajul cerut', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article(/Conexiune Google Analytics 4/)
    const field = within(card).getByLabelText('Rotește tokenul')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'tok-super-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea pentru a confirma că funcționează.')).toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(document.body.textContent).not.toContain('tok-super-secret')
    expect(within(card).getByText('Testarea conexiunii nu este disponibilă pentru această sursă.')).toBeInTheDocument()
  })

  it('adaugă o conexiune nouă, care apare în listă fără token', async () => {
    useBrand('brand-proenzi')
    renderApp({ route: URL })
    await pageReady('Surse')
    const form = await screen.findByRole('form', { name: 'Adaugă conexiune' })
    await userEvent.selectOptions(within(form).getByLabelText('Sursă'), 'gsc')
    await userEvent.type(within(form).getByLabelText('Cont sau proiect'), 'sc-domain:proenzi.example')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const card = await article('Conexiune Search Console')
    expect(within(card).getByText('Token neconfigurat')).toBeInTheDocument()
  })

  it('istoricul sincronizărilor are rânduri cu status', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Istoricul sincronizărilor' })).closest('section')!
    const table = await within(s).findByRole('table')
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('doar agency_admin: strategist și client sunt redirecționați', async () => {
    renderApp({ route: URL, role: 'strategist' })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
    expect(screen.queryByRole('heading', { name: 'Starea surselor' })).toBeNull()
  })
})

describe('Administrare → Surse cu providerul real (client fals)', () => {
  const row = { id: 'c-9', brand_id: 'brand-urinal', provider: 'clarity', external_account_id: 'proj-9', display_name: 'Urinal', credential_status: 'unverified', last_validated_at: null, last_validation_error: null, credential_updated_by: '6f1b2c3d-1111-4222-8333-444455556666', credential_updated_at: '2026-10-07T08:00:00Z', status: 'active' }

  it('citește prin client, trimite tokenul doar spre funcția server și nu îl arată', async () => {
    useBrand('brand-urinal')
    const fake = fakeDataClient({
      tables: { source_connections: [row], provider_api_calls: [{ source_connection_id: 'c-9', brand_id: 'brand-urinal', calls: 2, call_date_utc: new Date().toISOString().slice(0, 10) }], sync_runs: [], import_batches: [] },
      invoke: () => ({ data: { connection_id: 'c-9', credential_status: 'unverified' } }),
    })
    renderApp({ route: URL, wrap: (b) => ({ ...b, sources: createSupabaseSources(fake.client) }) })
    await pageReady('Surse')
    const card = await article('Conexiune Microsoft Clarity · Urinal')
    expect(within(card).getByText('Token salvat, netestat')).toBeInTheDocument()
    expect(within(card).getByText(/Azi: 2 folosite/)).toBeInTheDocument()
    expect(within(card).getByText('utilizator 6f1b2c3d')).toBeInTheDocument()
    await userEvent.type(within(card).getByLabelText('Rotește tokenul'), 'abc-secret-123')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    await within(card).findByText(/Token salvat\. Testează/)
    expect(fake.invocations).toEqual([{ name: 'source-credentials', body: { action: 'set_token', connection_id: 'c-9', token: 'abc-secret-123' } }])
    expect(document.body.textContent).not.toContain('abc-secret-123')
  })

  it('eroarea funcției server se vede, iar câmpul se golește oricum', async () => {
    useBrand('brand-urinal')
    const fake = fakeDataClient({
      tables: { source_connections: [row], provider_api_calls: [], sync_runs: [], import_batches: [] },
      invoke: () => ({ error: { message: 'x', context: { json: async () => ({ error: 'Token gol sau prea lung.' }) } } }),
    })
    renderApp({ route: URL, wrap: (b) => ({ ...b, sources: createSupabaseSources(fake.client) }) })
    await pageReady('Surse')
    const card = await article(/Conexiune Microsoft Clarity/)
    const field = within(card).getByLabelText('Rotește tokenul')
    await userEvent.type(field, 'x')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('Token gol sau prea lung.')
    expect(field).toHaveValue('')
  })
})
