import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseConfig } from '../../data/supabase/adminProviders'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { fakeDataClient } from '../../test/fakeDataClient'
import { addDays, todayBucharest } from '../../lib/period'
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
    // O schimbare e o versiune nouă, nu o editare a celei existente.
    expect(within(s).getByRole('button', { name: 'Versiune nouă' })).toBeInTheDocument()
    expect(within(s).queryByRole('button', { name: /Modifică|Editează|Șterge/ })).toBeNull()
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

  it('prima versiune: din propunerile Planable și SEOmonitor, cu dată în trecut; apare în tabel ca în vigoare', async () => {
    useBrand('brand-proenzi')
    renderApp({ route: URL })
    await pageReady('Configurare')
    const s = await section('Competitori')
    await userEvent.click(await within(s).findByRole('button', { name: 'Configurează competitorii' }))
    const dialog = await screen.findByRole('dialog', { name: 'Configurează competitorii' })
    const date = within(dialog).getByLabelText('Se aplică de la') as HTMLInputElement
    expect(date.value).toBe(addDays(todayBucharest(), -365))
    expect(dialog).toHaveTextContent('Prima versiune poate începe în trecut')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Propune din surse' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Adaugă Digestil' }))
    // Domeniul se leagă de competitorul ales fără domeniu, nu devine un competitor nou.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adaugă digestil.example' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adaugă Enzimax' }))
    expect(within(dialog).getByLabelText('Numele competitorului 1')).toHaveValue('Digestil')
    expect(within(dialog).getByLabelText('Domeniul competitorului 1')).toHaveValue('digestil.example')
    expect(within(dialog).getByLabelText('Numele competitorului 2')).toHaveValue('Enzimax')
    expect(within(dialog).getByLabelText('Domeniul competitorului 2')).toHaveValue('')
    // Profilul Instagram adăugat odată cu competitorul; profilul de Facebook al aceluiași competitor se leagă de C1.
    expect(within(dialog).queryByRole('button', { name: 'Adaugă Digestil' })).toBeNull()
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Leagă Digestil România de un competitor ales' }), 'C1 · Digestil')
    const c1 = within(dialog).getByRole('list', { name: 'Profilurile sociale ale competitorului 1' })
    expect(c1).toHaveTextContent('Instagram@digestil.ro')
    expect(c1).toHaveTextContent('Facebook@digestil')
    expect(within(dialog).getByRole('list', { name: 'Profilurile sociale ale competitorului 2' })).toHaveTextContent(/^Instagram@enzimax/)
    // Un profil se poate scoate.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Scoate profilul Facebook @digestil de la competitorul 1' }))
    expect(c1).not.toHaveTextContent('Facebook')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Leagă Digestil România de un competitor ales' }), 'C1 · Digestil')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Creează versiunea' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const table = await within(s).findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]!).getByText('v1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('În vigoare')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('Digestil · digestil.example')
    expect(rows[0]).toHaveTextContent('Instagram @digestil.ro · Facebook @digestil')
    expect(rows[0]).toHaveTextContent('Enzimax')
  })

  it('versiune nouă: pornește de la versiunea în vigoare; o dată în trecut e refuzată înainte de trimitere', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Configurare')
    await userEvent.click(await within(await section('Competitori')).findByRole('button', { name: 'Versiune nouă' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Numele competitorului 1')).toHaveValue('Uronova')
    expect(within(dialog).getByLabelText('Numele competitorului 3')).toHaveValue('Vitamerin')
    const date = within(dialog).getByLabelText('Se aplică de la') as HTMLInputElement
    expect(date.value).toBe(todayBucharest())
    fireEvent.change(date, { target: { value: addDays(todayBucharest(), -1) } })
    expect(dialog).toHaveTextContent('doar prima versiune poate începe în trecut')
    expect(within(dialog).getByRole('button', { name: 'Creează versiunea' })).toBeDisabled()
    fireEvent.change(date, { target: { value: addDays(todayBucharest(), 7) } })
    await userEvent.type(within(dialog).getByLabelText('Domeniul competitorului 2'), '-greșit domeniu')
    expect(dialog).toHaveTextContent('nu arată a domeniu')
    expect(within(dialog).getByRole('button', { name: 'Creează versiunea' })).toBeDisabled()
  })

  it('propuneri fără surse: fiecare sursă spune „Sursă neconectată” și de ce, fără liste inventate', async () => {
    useBrand('brand-minimartieni')
    renderApp({ route: URL })
    await pageReady('Configurare')
    await userEvent.click(await within(await section('Competitori')).findByRole('button', { name: 'Versiune nouă' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Propune din surse' }))
    const box = await within(dialog).findByRole('region', { name: 'Propuneri din surse' })
    await waitFor(() => expect(within(box).getAllByText('Sursă neconectată.')).toHaveLength(2))
    expect(box).toHaveTextContent('workspace Planable')
    expect(box).toHaveTextContent('SEOmonitor conectat')
    expect(within(box).queryByRole('button', { name: /^Adaugă / })).toBeNull()
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
