import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseSources } from '../../data/supabase/sourcesProvider'
import { fakeDataClient } from '../../test/fakeDataClient'
import { pageReady, renderApp, where } from '../../test/renderApp'

const site = (id: string, search = '') => `/admin/clients/${id}${search}`
const article = (name: RegExp | string) => screen.findByRole('article', { name })

/** Deschide cardul unei surse și îl întoarce. */
async function open(name: string) {
  const card = await article(name)
  await userEvent.click(within(card).getByRole('button', { name: /^(Conectează|Gestionează)$/ }))
  return card
}

describe('pagina site-ului: sursele, fiecare conectată pe site (fixtures de previzualizare)', () => {
  it('toate sursele site-ului, în ordine, cu starea fiecăreia; fără pagină Surse în meniu', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const section = (await screen.findByRole('heading', { level: 2, name: 'Surse' })).closest('section')!
    const cards = within(section).getAllByRole('article')
    expect(cards.map((a) => a.getAttribute('aria-label'))).toEqual(['Google Analytics 4', 'Search Console', 'Microsoft Clarity', 'SEOmonitor', 'Planable', 'Meta Ads', 'Google Ads', 'TikTok Ads', 'Import CSV'])
    expect(cards.map((a) => a.getAttribute('data-state')).slice(0, 5)).toEqual(['connected', 'stale', 'error', 'partial', 'not_connected'])
    const admin = screen.getByRole('navigation', { name: 'Administrare' })
    expect(within(admin).queryByRole('link', { name: 'Surse' })).toBeNull()
  })

  it('cardul se deschide din adresă (?source=) și se închide', async () => {
    renderApp({ route: site('brand-urinal', '?source=clarity') })
    await pageReady('Site și surse')
    const card = await article('Microsoft Clarity')
    expect(await within(card).findByRole('article', { name: 'Conexiune Microsoft Clarity · urinal.example' })).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Închide' }))
    expect(within(card).queryByRole('article')).toBeNull()
    expect(where()).toBe(site('brand-urinal'))
  })

  it('Clarity: tokenul propriu al site-ului, bugetul și testul', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const card = await open('Microsoft Clarity')
    const conn = within(card).getByRole('article', { name: 'Conexiune Microsoft Clarity · urinal.example' })
    expect(within(conn).getByText('Token refuzat de furnizor')).toBeInTheDocument()
    expect(within(conn).getByText('Testarea consumă 1 din cele 10 apeluri zilnice. Azi: 3 folosite.')).toBeInTheDocument()
    await userEvent.click(within(conn).getByRole('button', { name: 'Testează conexiunea' }))
    expect(await within(conn).findByText('Conexiunea funcționează.')).toBeInTheDocument()
    expect(within(conn).getByText('Testarea consumă 1 din cele 10 apeluri zilnice. Azi: 4 folosite.')).toBeInTheDocument()
  })

  it('tokenul: câmp parolă, golit după salvare, niciodată afișat', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const card = await open('Microsoft Clarity')
    const field = within(card).getByLabelText('Rotește tokenul')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'tok-super-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea pentru a confirma că funcționează.')).toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(document.body.textContent).not.toContain('tok-super-secret')
  })

  it('bugetul consumat dezactivează testul și explică resetarea', async () => {
    renderApp({ route: site('brand-minimartieni') })
    await pageReady('Site și surse')
    const card = await open('Microsoft Clarity')
    expect(within(card).getByRole('button', { name: 'Testează conexiunea' })).toBeDisabled()
    expect(within(card).getByText(/Se resetează la 00:00 UTC \(03:00 ora României vara, 02:00 iarna\)/)).toBeInTheDocument()
  })

  it('GA4: pasul 1 cere cheia Google a clientului; după salvare, cheia apare refolosită, fără conținutul ei', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const card = await open('Google Analytics 4')
    const step1 = within(card).getByRole('region', { name: 'Cheia Google (service account) a clientului' })
    expect(within(step1).getByText(/nu are încă această cheie/)).toBeInTheDocument()
    const keyCard = within(step1).getByRole('article', { name: 'Cheia Google a clientului' })
    await userEvent.upload(within(keyCard).getByLabelText('Încarcă cheia JSON'), new File(['{"web":{}}'], 'gresit.json', { type: 'application/json' }))
    expect(await within(keyCard).findByText(/OAuth client/)).toBeInTheDocument()
    const key = { type: 'service_account', project_id: 'analyzator-stada', client_email: 'analyzator@analyzator-stada.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nSECRET-KEY-BODY\n-----END PRIVATE KEY-----\n' }
    await userEvent.upload(within(keyCard).getByLabelText('Încarcă cheia JSON'), new File([JSON.stringify(key)], 'cheie.json', { type: 'application/json' }))
    await userEvent.click(await within(keyCard).findByRole('button', { name: 'Salvează cheia' }))
    expect(await within(step1).findByText(/Folosește cheia clientului STADA România/)).toBeInTheDocument()
    expect(within(step1).getByText(key.client_email)).toBeInTheDocument()
    expect(within(step1).getByText('Token salvat, netestat')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('SECRET-KEY-BODY')

    // Pasul 2: proprietatea site-ului, fără token propriu.
    const step2 = within(card).getByRole('region', { name: 'Contul Urinal în Google Analytics 4' })
    const conn = within(step2).getByRole('article', { name: /Conexiune Google Analytics 4/ })
    expect(within(conn).getByText('Cheia clientului')).toBeInTheDocument()
    expect(within(conn).queryByLabelText(/tokenul/)).toBeNull()
  })

  it('Search Console: proprietatea se adaugă direct în cardul sursei', async () => {
    renderApp({ route: site('brand-proenzi') })
    await pageReady('Site și surse')
    const card = await open('Search Console')
    const form = within(card).getByRole('form', { name: 'Adaugă conexiunea Search Console' })
    expect(within(form).queryByLabelText('Sursă')).toBeNull()
    await userEvent.type(within(form).getByLabelText('Proprietatea Search Console'), 'sc-domain:proenzi.example')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const conn = await within(card).findByRole('article', { name: /Conexiune Search Console/ })
    expect(within(conn).getByText('sc-domain:proenzi.example')).toBeInTheDocument()
  })

  it('Planable: tokenul salvat pe un site e refolosit automat pe celelalte site-uri ale clientului', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    let card = await open('Planable')
    const account = within(card).getByRole('article', { name: 'Contul Planable al clientului' })
    await userEvent.type(within(account).getByLabelText('Numele companiei în Planable'), 'STADA România')
    await userEvent.type(within(account).getByLabelText('Token API'), 'pln_secret123')
    await userEvent.click(within(account).getByRole('button', { name: 'Salvează' }))
    expect(await within(card).findByText(/Folosește cheia clientului STADA România/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('pln_secret123')

    const form = within(card).getByRole('form', { name: 'Adaugă conexiunea Planable' })
    expect(within(form).getByLabelText('Workspace Planable')).toHaveAttribute('placeholder', 'ID-ul workspace-ului Planable')
    await userEvent.type(within(form).getByLabelText('Workspace Planable'), 'ws-urinal')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const conn = await within(card).findByRole('article', { name: 'Conexiune Planable' })
    expect(within(conn).getByText(/folosește tokenul Planable al clientului \(pasul 1\)/)).toBeInTheDocument()

    // Alt site al aceluiași client: tokenul nu se mai cere.
    await userEvent.click(screen.getByRole('link', { name: 'Înapoi la clienți și site-uri' }))
    await pageReady('Clienți și site-uri')
    await userEvent.click(await screen.findByRole('button', { name: 'Editează Proenzi și sursele lui' }))
    await pageReady('Site și surse')
    card = await open('Planable')
    expect(within(card).getByText(/Folosește cheia clientului STADA România/)).toBeInTheDocument()
    expect(within(card).queryByLabelText('Token API')).toBeNull()
    expect(within(card).getByRole('form', { name: 'Adaugă conexiunea Planable' })).toBeInTheDocument()
  })

  it('SEOmonitor: contul clientului e refolosit; „Schimbă cheia” rotește tokenul; grupurile se mapează în Configurare', async () => {
    renderApp({ route: site('brand-minimartieni') })
    await pageReady('Site și surse')
    const card = await open('SEOmonitor')
    expect(within(card).getByText('Conexiune funcțională')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Schimbă cheia' }))
    const field = within(card).getByLabelText('Rotește tokenul')
    await userEvent.type(field, 'jwt-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează' }))
    expect(await within(card).findByText('Token salvat. Testează conexiunea sau așteaptă prima rulare SEOmonitor.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('jwt-secret')
    await userEvent.click(within(card).getByRole('button', { name: 'Mapează în Configurare' }))
    await waitFor(() => expect(where()).toBe('/admin/config'))
  })

  it('Meta Ads: fără token, contul de ads se poate adăuga, cu avertismentul că nu pornește colectarea', async () => {
    renderApp({ route: site('brand-proenzi') })
    await pageReady('Site și surse')
    const card = await open('Meta Ads')
    expect(within(card).getByText(/Fără cheia clientului de la pasul 1/)).toBeInTheDocument()
    const form = within(card).getByRole('form', { name: 'Adaugă conexiunea Meta Ads' })
    expect(within(form).getByLabelText('Contul de ads Meta')).toHaveAttribute('placeholder', 'Contul de ads: act_1234567890')
  })

  it('OAuth Google Ads: MCC obligatoriu; în previzualizare conectarea e simulată', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const card = await open('Google Ads')
    const button = within(card).getByRole('button', { name: 'Conectează cu Google' })
    expect(button).toBeDisabled()
    await userEvent.type(within(card).getByLabelText('ID-ul contului de manager (MCC)'), '123-456-7890')
    await userEvent.click(button)
    expect(await within(card).findByText(/Folosește cheia clientului STADA România/)).toBeInTheDocument()
    const tiktok = await open('TikTok Ads')
    expect(within(tiktok).queryByLabelText(/MCC/)).toBeNull()
  })

  it('întoarcerea OAuth: mesajul în română; cardul sursei rămâne deschis, fără parametrii OAuth', async () => {
    renderApp({ route: site('brand-urinal', '?oauth=google_ads&result=error&reason=state_invalid') })
    await pageReady('Site și surse')
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Ads nu a fost conectat. Link de conectare expirat sau deja folosit.')
    await waitFor(() => expect(where()).toBe(site('brand-urinal', '?source=google_ads')))
    expect(within(await article('Google Ads')).getByRole('button', { name: 'Închide' })).toBeInTheDocument()
  })

  it('istoricul sincronizărilor are rânduri cu status', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Istoricul sincronizărilor' })).closest('section')!
    expect(within(await within(s).findByRole('table')).getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('un site necunoscut: mesaj, fără surse', async () => {
    renderApp({ route: site('nu-exista') })
    await pageReady('Site și surse')
    expect(await screen.findByRole('heading', { name: 'Site negăsit' })).toBeInTheDocument()
  })
})

describe('pagina site-ului cu providerul real (client fals)', () => {
  const row = { id: 'c-9', brand_id: 'brand-urinal', provider: 'clarity', external_account_id: 'proj-9', display_name: 'Urinal', credential_status: 'unverified', last_validated_at: null, last_validation_error: null, credential_updated_by: '6f1b2c3d-1111-4222-8333-444455556666', credential_updated_at: '2026-10-07T08:00:00Z', status: 'active' }

  it('tokenul pleacă doar spre funcția server și nu se afișează', async () => {
    const fake = fakeDataClient({
      tables: { source_connections: [row], provider_api_calls: [{ source_connection_id: 'c-9', brand_id: 'brand-urinal', calls: 2, call_date_utc: new Date().toISOString().slice(0, 10) }], sync_runs: [], import_batches: [] },
      invoke: () => ({ data: { connection_id: 'c-9', credential_status: 'unverified' } }),
    })
    renderApp({ route: site('brand-urinal', '?source=clarity'), wrap: (b) => ({ ...b, sources: createSupabaseSources(fake.client) }) })
    await pageReady('Site și surse')
    const card = await article('Conexiune Microsoft Clarity · Urinal')
    expect(within(card).getByText(/Azi: 2 folosite/)).toBeInTheDocument()
    expect(within(card).getByText('utilizator 6f1b2c3d')).toBeInTheDocument()
    await userEvent.type(within(card).getByLabelText('Rotește tokenul'), 'abc-secret-123')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    await within(card).findByText(/Token salvat\. Testează/)
    expect(fake.invocations).toEqual([{ name: 'source-credentials', body: { action: 'set_token', connection_id: 'c-9', token: 'abc-secret-123' } }])
    expect(document.body.textContent).not.toContain('abc-secret-123')
  })

  it('eroarea funcției server se vede, iar câmpul se golește oricum', async () => {
    const fake = fakeDataClient({
      tables: { source_connections: [row], provider_api_calls: [], sync_runs: [], import_batches: [] },
      invoke: () => ({ error: { message: 'x', context: { json: async () => ({ error: 'Token gol sau prea lung.' }) } } }),
    })
    renderApp({ route: site('brand-urinal', '?source=clarity'), wrap: (b) => ({ ...b, sources: createSupabaseSources(fake.client) }) })
    await pageReady('Site și surse')
    const card = await article(/Conexiune Microsoft Clarity/)
    const field = within(card).getByLabelText('Rotește tokenul')
    await userEvent.type(field, 'x')
    await userEvent.click(within(card).getByRole('button', { name: 'Salvează tokenul' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('Token gol sau prea lung.')
    expect(field).toHaveValue('')
  })
})
