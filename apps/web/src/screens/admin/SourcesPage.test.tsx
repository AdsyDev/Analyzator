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
    const card = await article('Conexiune Microsoft Clarity · urinal.example')
    const field = within(card).getByLabelText('Rotește tokenul')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'tok-super-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea pentru a confirma că funcționează.')).toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(document.body.textContent).not.toContain('tok-super-secret')
  })

  it('GA4 și Search Console nu au token propriu: folosesc cheia Google a clientului', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article(/Conexiune Google Analytics 4/)
    expect(within(card).queryByLabelText(/tokenul/)).toBeNull()
    expect(within(card).getByText('Cheia clientului')).toBeInTheDocument()
    expect(within(card).getByText(/folosește cheia Google din „Conturile clientului”/)).toBeInTheDocument()
  })

  it('adaugă o conexiune nouă pe brand; SEOmonitor nu mai e în listă (e cont al clientului)', async () => {
    useBrand('brand-proenzi')
    renderApp({ route: URL })
    await pageReady('Surse')
    const form = await screen.findByRole('form', { name: 'Adaugă conexiune' })
    expect(within(form).queryByRole('option', { name: 'SEOmonitor' })).toBeNull()
    await userEvent.selectOptions(within(form).getByLabelText('Sursă'), 'gsc')
    await userEvent.type(within(form).getByLabelText('Cont sau proiect'), 'sc-domain:proenzi.example')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const card = await article('Conexiune Search Console')
    expect(within(card).getByText('Cheia clientului')).toBeInTheDocument()
  })

  it('cheia Google: fișierul se verifică în browser, se salvează și nu apare nicăieri pe ecran', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Cheia Google a clientului')
    expect(within(card).getByText('Token neconfigurat')).toBeInTheDocument()
    const input = within(card).getByLabelText('Încarcă cheia JSON')
    await userEvent.upload(input, new File(['{"web":{}}'], 'gresit.json', { type: 'application/json' }))
    expect(await within(card).findByText(/OAuth client/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Salvează cheia' })).toBeDisabled()
    const key = { type: 'service_account', project_id: 'analyzator-stada', client_email: 'analyzator@analyzator-stada.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nSECRET-KEY-BODY\n-----END PRIVATE KEY-----\n' }
    await userEvent.upload(within(card).getByLabelText('Încarcă cheia JSON'), new File([JSON.stringify(key)], 'cheie.json', { type: 'application/json' }))
    expect(await within(card).findByText(/Cheie validă pentru/)).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează cheia' }))
    expect(await within(card).findByText(/Cheia a fost salvată/)).toBeInTheDocument()
    expect(within(card).getByText(key.client_email)).toBeInTheDocument()
    await waitFor(() => expect(within(card).getByText('Token salvat, netestat')).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('SECRET-KEY-BODY')
  })

  it('SEOmonitor e cont al clientului: tokenul se rotește din formular', async () => {
    useBrand('brand-minimartieni')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Contul SEOmonitor al clientului')
    expect(within(card).getByText('Conexiune funcțională')).toBeInTheDocument()
    expect(within(card).queryByLabelText(/company_id/)).toBeNull()
    const field = within(card).getByLabelText('Rotește tokenul')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'jwt-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea sau așteaptă prima rulare SEOmonitor.')).toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(document.body.textContent).not.toContain('jwt-secret')
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

  it('Planable: contul clientului cu token și test, apoi workspace-ul pe brand fără token propriu', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Contul Planable al clientului')
    expect(within(card).getByText('Token neconfigurat')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Testează conexiunea' })).toBeNull()
    await userEvent.type(within(card).getByLabelText('Numele companiei în Planable'), 'STADA România')
    await userEvent.type(within(card).getByLabelText('Token API'), 'pln_secret123')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea pentru a confirma că funcționează.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('pln_secret123')
    await userEvent.click(await within(card).findByRole('button', { name: 'Testează conexiunea' }))
    expect(await within(card).findByText('Conexiunea funcționează.')).toBeInTheDocument()

    const form = screen.getByRole('form', { name: 'Adaugă conexiune' })
    await userEvent.selectOptions(within(form).getByLabelText('Sursă'), 'planable')
    expect(within(form).getByLabelText('Cont sau proiect')).toHaveAttribute('placeholder', 'ID-ul workspace-ului Planable')
    await userEvent.type(within(form).getByLabelText('Cont sau proiect'), 'ws-urinal')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const conn = await article('Conexiune Planable')
    expect(within(conn).queryByLabelText(/tokenul/)).toBeNull()
    expect(within(conn).getByText(/folosește tokenul Planable din „Conturile clientului”/)).toBeInTheDocument()
  })

  it('Meta Ads: tokenul system user în contul clientului, contul de ads pe brand fără token propriu', async () => {
    useBrand('brand-proenzi')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Contul Meta Ads al clientului')
    await userEvent.type(within(card).getByLabelText('Business Manager'), 'BM AdSymphony')
    await userEvent.type(within(card).getByLabelText('Token API'), 'EAAG-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea pentru a confirma că funcționează.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('EAAG-secret')

    const form = screen.getByRole('form', { name: 'Adaugă conexiune' })
    await userEvent.selectOptions(within(form).getByLabelText('Sursă'), 'meta_ads')
    expect(within(form).getByLabelText('Cont sau proiect')).toHaveAttribute('placeholder', 'Contul de ads: act_1234567890')
    await userEvent.type(within(form).getByLabelText('Cont sau proiect'), 'act_111')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const conn = await article('Conexiune Meta Ads')
    expect(within(conn).getByText(/folosește tokenul Meta din „Conturile clientului”/)).toBeInTheDocument()
  })

  it('OAuth Google Ads: MCC-ul e obligatoriu; în previzualizare conectarea e simulată', async () => {
    useBrand('brand-urinal')
    renderApp({ route: URL })
    await pageReady('Surse')
    const card = await article('Contul Google Ads al clientului')
    const button = within(card).getByRole('button', { name: 'Conectează cu Google' })
    expect(button).toBeDisabled()
    await userEvent.type(within(card).getByLabelText('ID-ul contului de manager (MCC)'), '123-456-7890')
    await userEvent.click(button)
    expect(await within(card).findByText('Previzualizare: conectarea e simulată, fără furnizor real.')).toBeInTheDocument()
    expect(await within(card).findByText('Conexiune funcțională')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Reconectează' })).toBeInTheDocument()
    const tiktok = await article('Contul TikTok Ads al clientului')
    expect(within(tiktok).queryByLabelText(/MCC/)).toBeNull()
  })

  it('întoarcerea OAuth: mesajul în română, fără parametri rămași în adresă', async () => {
    useBrand('brand-urinal')
    renderApp({ route: `${URL}?oauth=google_ads&result=error&reason=state_invalid` })
    await pageReady('Surse')
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Ads nu a fost conectat. Link de conectare expirat sau deja folosit.')
    await waitFor(() => expect(where()).toBe(URL))
  })

  it('întoarcerea OAuth reușită', async () => {
    useBrand('brand-urinal')
    renderApp({ route: `${URL}?oauth=tiktok_ads&result=ok` })
    await pageReady('Surse')
    expect(await screen.findByText('TikTok Ads a fost conectat.')).toBeInTheDocument()
  })
})
