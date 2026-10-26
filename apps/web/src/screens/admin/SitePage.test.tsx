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
    // Doar accesul contează: confirmat de ultima colectare cu date, fără test, buget sau „configurat de”.
    expect(within(conn).getByText('Acces confirmat')).toBeInTheDocument()
    expect(within(conn).getByText(/Confirmat de colectarea din .*: 28 de rânduri\./)).toBeInTheDocument()
    for (const gone of ['Ultima testare', 'Configurat de', 'Apeluri azi', 'Netestat', 'Cheia clientului']) expect(within(conn).queryByText(gone)).toBeNull()
    expect(within(conn).queryByText(/Testarea conexiunii nu este disponibilă|Nu are token propriu/)).toBeNull()
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

    // Pasul 2: workspace-ul se alege din lista văzută de token, cu cel al site-ului propus.
    const form = within(card).getByRole('form', { name: 'Adaugă conexiunea Planable' })
    const select = await within(form).findByLabelText('Workspace-ul Planable')
    expect(select).toHaveValue('ws-brand-urinal')
    expect(within(form).getByText(/Propus după numele sau domeniul site-ului/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Nume afișat (opțional)')).toHaveValue('Urinal')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    const conn = await within(card).findByRole('article', { name: 'Conexiune Planable · Urinal' })
    expect(within(conn).getByText('ws-brand-urinal')).toBeInTheDocument()
    expect(within(conn).getByText('Neverificat')).toBeInTheDocument()
    expect(within(conn).getByText(/se confirmă la prima colectare/)).toBeInTheDocument()

    // Alt site al aceluiași client: tokenul nu se mai cere.
    await userEvent.click(screen.getByRole('link', { name: 'Înapoi la clienți și site-uri' }))
    await pageReady('Clienți și site-uri')
    await userEvent.click(await screen.findByRole('button', { name: 'Editează Proenzi și sursele lui' }))
    await pageReady('Site și surse')
    card = await open('Planable')
    expect(within(card).getByText(/Folosește cheia clientului STADA România/)).toBeInTheDocument()
    expect(within(card).queryByLabelText('Token API')).toBeNull()
    expect(await within(card).findByLabelText('Workspace-ul Planable')).toHaveValue('ws-brand-proenzi')
  })

  it('selectorul: altă alegere din listă sau introducere manuală', async () => {
    renderApp({ route: site('brand-proenzi') })
    await pageReady('Site și surse')
    const card = await open('Meta Ads')
    const account = within(card).getByRole('article', { name: 'Contul Meta Ads al clientului' })
    await userEvent.type(within(account).getByLabelText('Business Manager'), 'BM AdSymphony')
    await userEvent.type(within(account).getByLabelText('Token API'), 'EAAG-secret')
    await userEvent.click(within(account).getByRole('button', { name: 'Salvează' }))
    const select = await within(card).findByRole('combobox', { name: 'Contul de ads Meta' })
    expect(select).toHaveValue('act_1002')
    await userEvent.selectOptions(select, 'act_1001')
    expect(within(card).getByLabelText('Nume afișat (opțional)')).toHaveValue('Minimartieni RO')
    const form = within(card).getByRole('form', { name: 'Adaugă conexiunea Meta Ads' })
    await userEvent.click(within(form).getByRole('button', { name: 'Nu e în listă? Introdu manual' }))
    const manual = within(form).getByLabelText('Contul de ads Meta')
    expect(manual.tagName).toBe('INPUT')
    await userEvent.type(manual, 'act_999')
    await userEvent.click(within(form).getByRole('button', { name: 'Adaugă conexiunea' }))
    expect(await within(card).findByText('act_999')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('EAAG-secret')
  })

  it('GA4: Admin API neactivat → motivul vizibil, câmpul manual doar la cerere', async () => {
    renderApp({
      route: site('brand-proenzi'),
      wrap: (b) => ({
        ...b,
        sources: {
          ...b.sources,
          tenantConnections: async (t) => {
            const r = await b.sources.tenantConnections(t)
            return r.kind === 'ready' ? { kind: 'ready' as const, data: [...r.data, { id: 'gkey', tenant_id: t, provider: 'google_service_account' as const, external_account_id: 'sa@p.iam.gserviceaccount.com', display_name: null, credential_status: 'valid' as const, credential_updated_at: null }] } : r
          },
          listAccounts: async () => ({ kind: 'ready' as const, data: { outcome: 'api_disabled' as const, credential_status: 'valid' as const, accounts: [], truncated: false, message: 'Google Analytics Admin API nu e activat în proiectul Google Cloud al cheii.' } }),
        },
      }),
    })
    await pageReady('Site și surse')
    const card = await open('Google Analytics 4')
    const form = await within(card).findByRole('form', { name: 'Adaugă conexiunea Google Analytics 4' })
    expect(await within(form).findByRole('alert')).toHaveTextContent('Google Analytics Admin API nu e activat')
    expect(within(form).queryByLabelText('Property ID GA4')).toBeNull()
    await userEvent.click(within(form).getByRole('button', { name: 'Nu e în listă? Introdu manual' }))
    expect(within(form).getByLabelText('Property ID GA4')).toBeInTheDocument()
  })

  it('lista nu poate fi citită: motivul, „Reîncarcă lista” și câmpul manual', async () => {
    renderApp({
      route: site('brand-urinal'),
      wrap: (b) => ({
        ...b,
        sources: { ...b.sources, listAccounts: async () => ({ kind: 'ready' as const, data: { outcome: 'api_disabled' as const, credential_status: 'valid' as const, accounts: [], truncated: false, message: 'Google Analytics Admin API nu e activat în proiectul Google Cloud al cheii.' } }) },
      }),
    })
    await pageReady('Site și surse')
    const card = await open('SEOmonitor')
    expect(await within(card).findByRole('alert')).toHaveTextContent('Google Analytics Admin API nu e activat')
    expect(within(card).getByRole('button', { name: 'Reîncarcă' })).toBeInTheDocument()
  })

  it('SEOmonitor: campania propusă după domeniu; grupurile se mapează din card, cu grupul principal obligatoriu', async () => {
    renderApp({ route: site('brand-urinal') })
    await pageReady('Site și surse')
    const card = await open('SEOmonitor')
    const mapping = await within(card).findByRole('region', { name: 'Maparea SEOmonitor a site-ului' })
    expect(within(mapping).getByLabelText('Campania SEOmonitor')).toHaveValue('500')
    expect(within(mapping).getByText(/Propusă după domeniul site-ului/)).toBeInTheDocument()
    await within(mapping).findByRole('list', { name: 'Grupurile campaniei' })
    await userEvent.click(within(mapping).getByRole('checkbox', { name: 'Urinal brand pe Urinal' }))
    await userEvent.click(within(mapping).getByRole('checkbox', { name: 'Urinal generic pe Urinal' }))
    expect(within(mapping).getByRole('combobox', { name: 'Tipul grupului Urinal brand' })).toHaveValue('branded')
    expect(within(mapping).getByRole('combobox', { name: 'Tipul grupului Urinal generic' })).toHaveValue('nonbranded')
    const save = within(mapping).getByRole('button', { name: 'Salvează maparea' })
    expect(save).toBeDisabled()
    expect(within(mapping).getByText('Alege grupul principal dintre cele bifate.')).toBeInTheDocument()
    await userEvent.click(within(mapping).getByRole('radio', { name: 'Urinal brand e grupul principal' }))
    await userEvent.click(save)
    expect(await within(mapping).findByText(/Maparea a fost salvată, în vigoare din/)).toBeInTheDocument()
    expect(await within(mapping).findByText('Nicio schimbare față de maparea salvată.')).toBeInTheDocument()

    // Pe alt site al clientului, același grup apare „Mapat pe Urinal” și nu se poate bifa.
    await userEvent.click(screen.getByRole('link', { name: 'Înapoi la clienți și site-uri' }))
    await pageReady('Clienți și site-uri')
    await userEvent.click(await screen.findByRole('button', { name: 'Editează Proenzi și sursele lui' }))
    await pageReady('Site și surse')
    const other = await open('SEOmonitor')
    const otherMapping = await within(other).findByRole('region', { name: 'Maparea SEOmonitor a site-ului' })
    await userEvent.selectOptions(within(otherMapping).getByLabelText('Campania SEOmonitor'), '500')
    await within(otherMapping).findByRole('list', { name: 'Grupurile campaniei' })
    expect(within(otherMapping).getByRole('checkbox', { name: 'Urinal brand pe Proenzi' })).toBeDisabled()
    expect(within(otherMapping).getAllByText('Mapat pe Urinal')).toHaveLength(2)
  })

  it('SEOmonitor: maparea automată apare bifată, „Automat”, ca grup principal, fără schimbări false', async () => {
    const auto = { campaign_id: '500', group_id: '5002', version: 1, effective_from: '2026-10-11', kind: 'brand' as const, brand_id: 'brand-urinal', brand_type: null, is_primary_visibility: true, note: 'Automat: domeniul campaniei = domeniul site-ului; grupul „All keywords” e principal.' }
    renderApp({ route: site('brand-urinal'), wrap: (b) => ({ ...b, config: { ...b.config, seomonitorMappings: async () => ({ kind: 'ready' as const, data: [auto] }) } }) })
    await pageReady('Site și surse')
    const card = await open('SEOmonitor')
    const mapping = await within(card).findByRole('region', { name: 'Maparea SEOmonitor a site-ului' })
    await within(mapping).findByRole('list', { name: 'Grupurile campaniei' })
    expect(within(mapping).getByRole('checkbox', { name: 'Urinal generic pe Urinal' })).toBeChecked()
    expect(within(mapping).getByText('Automat')).toBeInTheDocument()
    expect(within(mapping).getByRole('combobox', { name: 'Tipul grupului Urinal generic' })).toHaveValue('mixed')
    expect(within(mapping).getByRole('radio', { name: 'Urinal generic e grupul principal' })).toBeChecked()
    expect(within(mapping).getByText('Nicio schimbare față de maparea salvată.')).toBeInTheDocument()
  })

  it('SEOmonitor: un grup scos de pe site devine exclus (versiune nouă, nimic șters)', async () => {
    const saved: unknown[] = []
    renderApp({
      route: site('brand-urinal'),
      wrap: (b) => ({ ...b, config: { ...b.config, saveSeomonitorMappings: async (t, src, rows) => (saved.push(rows), b.config.saveSeomonitorMappings(t, src, rows)) } }),
    })
    await pageReady('Site și surse')
    const card = await open('SEOmonitor')
    const mapping = await within(card).findByRole('region', { name: 'Maparea SEOmonitor a site-ului' })
    await within(mapping).findByRole('list', { name: 'Grupurile campaniei' })
    await userEvent.click(within(mapping).getByRole('checkbox', { name: 'Urinal brand pe Urinal' }))
    await userEvent.click(within(mapping).getByRole('radio', { name: 'Urinal brand e grupul principal' }))
    await userEvent.click(within(mapping).getByRole('button', { name: 'Salvează maparea' }))
    await within(mapping).findByText(/Maparea a fost salvată/)
    await userEvent.click(within(mapping).getByRole('checkbox', { name: 'Urinal brand pe Urinal' }))
    await userEvent.click(within(mapping).getByRole('button', { name: 'Salvează maparea' }))
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]).toEqual([{ campaign_id: '500', group_id: '5001', kind: 'excluded', brand_id: null, brand_type: null, is_primary_visibility: false }])
  })

  it('SEOmonitor: contul clientului e refolosit; „Schimbă cheia” rotește tokenul; toate mapările rămân în Configurare', async () => {
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
    await userEvent.click(within(card).getByRole('button', { name: 'Toate mapările, în Configurare' }))
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
