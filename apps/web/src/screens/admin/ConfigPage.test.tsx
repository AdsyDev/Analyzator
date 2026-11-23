import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseConfig } from '../../data/supabase/adminProviders'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { fakeDataClient } from '../../test/fakeDataClient'
import { pageReady, renderApp, where } from '../../test/renderApp'

const URL = '/admin/config'
const useBrand = (id: string) => window.localStorage.setItem('az-brand', id)
const section = async (name: string) => (await screen.findByRole('heading', { level: 2, name })).closest('section')!

describe('Administrare → Configurare (fixtures de previzualizare)', () => {
  it('competitorii: versiunea în vigoare marcată, istoric cu dată efectivă și notă', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Configurare')
    const s = await section('Competitori')
    const table = await within(s).findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('v3')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('În vigoare')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/Uronova/)).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('În vigoare')).toBeNull()
    expect(within(rows[2]!).getByText('Set inițial, validat cu clientul.')).toBeInTheDocument()
    expect(s).toHaveTextContent(/Versiunile sunt imutabile/)
    // O versiune existentă nu se editează: doar „Versiune nouă” (deciziile Y-16).
    expect(within(s).queryByRole('button', { name: /Modifică|Editează|Șterge/ })).toBeNull()
    expect(within(s).getByRole('button', { name: 'Versiune nouă' })).toBeInTheDocument()
  })

  it('versiune nouă: pornește de la versiunea în vigoare, adaugă un competitor și identificatorii, devine versiunea în vigoare', async () => {
    useBrand('brand-urinal')
    const user = userEvent.setup()
    renderApp({ route: URL })
    await pageReady('Configurare')
    const s = await section('Competitori')
    await user.click(await within(s).findByRole('button', { name: 'Versiune nouă' }))
    const dialog = await screen.findByRole('dialog', { name: /Versiune nouă: competitorii Urinal/ })
    expect(within(dialog).getByText(/Pornește de la v3/)).toBeInTheDocument()
    const names = within(dialog).getAllByLabelText('Nume')
    expect(names[0]).toHaveValue('Uronova')
    await user.type(within(dialog).getAllByLabelText(/Cuvinte Planable Listening/)[0]!, 'uronova, uronova forte')
    await user.click(within(dialog).getByRole('button', { name: 'Adaugă competitor' }))
    const last = within(dialog).getAllByLabelText('Nume').at(-1)!
    await user.type(last, 'Prostamol')
    await user.type(within(dialog).getAllByLabelText('ID-uri advertiser Google').at(-1)!, 'AR01234567890')
    await user.click(within(dialog).getByRole('button', { name: 'Creează versiunea' }))
    expect(await screen.findByText(/Versiunea v4 a setului de competitori a fost creată/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Versiune nouă/ })).toBeNull())
    const rows = within(await within(s).findByRole('table')).getAllByRole('row').slice(1)
    await waitFor(() => expect(within(s).getByText('v4')).toBeInTheDocument())
    const v4 = within(s).getByText('v4').closest('tr')!
    expect(within(v4).getByText('În vigoare')).toBeInTheDocument()
    expect(v4).toHaveTextContent('uronova, uronova forte')
    expect(v4).toHaveTextContent('Prostamol')
    expect(v4).toHaveTextContent('AR01234567890')
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it('versiune nouă: un rând fără nume blochează trimiterea; eroarea serverului se afișează, iar dialogul rămâne deschis', async () => {
    useBrand('brand-urinal')
    const user = userEvent.setup()
    renderApp({
      route: URL,
      wrap: (b) => ({ ...b, config: { ...b.config, createCompetitorVersion: async () => ({ kind: 'error' as const, message: 'Membrul 2 (Cisticare): ID-ul de advertiser „X1” nu are forma AR urmat de cifre' }) } }),
    })
    await pageReady('Configurare')
    const s = await section('Competitori')
    await user.click(await within(s).findByRole('button', { name: 'Versiune nouă' }))
    const dialog = await screen.findByRole('dialog', { name: /Versiune nouă/ })
    const submit = within(dialog).getByRole('button', { name: 'Creează versiunea' })
    await user.clear(within(dialog).getAllByLabelText('Nume')[0]!)
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getAllByLabelText('Nume')[0]!, 'Uronova')
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Membrul 2 (Cisticare): ID-ul de advertiser')
    expect(screen.getByRole('dialog', { name: /Versiune nouă/ })).toBeInTheDocument()
  })

  it('aliasuri: listă; brand fără aliasuri are stare goală explicată', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Configurare')
    expect(await within(await section('Aliasuri')).findByText('Urinal Forte')).toBeInTheDocument()
  })

  it('brand fără aliasuri sau competitori: stări goale, nu zero', async () => {
    useBrand('brand-proenzi')
    renderApp({ route: URL })
    await pageReady('Configurare')
    expect(await within(await section('Aliasuri')).findByText('Niciun alias')).toBeInTheDocument()
    expect(await within(await section('Competitori')).findByText('Niciun set de competitori')).toBeInTheDocument()
  })

  it('maparea SEOmonitor: tip, brand, branded/nonbranded și versiune; multi-brand și exclus explicate', async () => {
    renderApp({ route: URL })
    await pageReady('Configurare')
    const s = await section('Grupuri SEOmonitor → brand')
    const table = await within(s).findByRole('table')
    expect(within(table).getAllByRole('row').length).toBe(6)
    expect(within(table).getByText('Multi-brand')).toBeInTheDocument()
    expect(within(table).getByText('Exclus')).toBeInTheDocument()
    expect(within(table).getByText('Nu se atribuie automat', { exact: false })).toBeInTheDocument()
    expect(within(table).getAllByText('Urinal').length).toBe(2)
  })

  it('doar agency_admin: client redirecționat', async () => {
    renderApp({ route: URL, role: 'client_viewer' })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
  })
})

describe('Administrare → Configurare cu providerul real', () => {
  it('fără client: „Sursă neconectată" pe fiecare secțiune, cu motiv', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL, wrap: (b) => ({ ...b, config: createSupabaseProviders().config }) })
    await pageReady('Configurare')
    expect((await screen.findAllByRole('heading', { name: 'Sursă neconectată' })).length).toBe(3)
  })

  it('cu client fals: aliasurile rămân neconectate (nu există tabel), restul vine din baze', async () => {
    useBrand('brand-urinal')
    const fake = fakeDataClient({
      tables: {
        competitor_sets: [{ id: 's1', brand_id: 'brand-urinal', version: 1, effective_from: '2026-01-01', note: null, created_at: '2026-01-01T00:00:00Z' }],
        competitor_set_members: [{ id: 'm1', brand_id: 'brand-urinal', competitor_set_id: 's1', name: 'Alfa', domain: null, sort_order: 0 }],
        seomonitor_group_mappings: [],
      },
    })
    renderApp({ route: URL, wrap: (b) => ({ ...b, config: createSupabaseConfig(fake.client) }) })
    await pageReady('Configurare')
    expect(await within(await section('Competitori')).findByText('Alfa')).toBeInTheDocument()
    expect(await within(await section('Aliasuri')).findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(await within(await section('Grupuri SEOmonitor → brand')).findByText('Nicio mapare')).toBeInTheDocument()
    for (const c of fake.calls.filter((c) => c.table.startsWith('competitor'))) expect(c.filters.some(([col, , v]) => col === 'brand_id' && v === 'brand-urinal')).toBe(true)
  })
})
