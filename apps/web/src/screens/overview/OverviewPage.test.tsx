import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { createUnconfiguredAuth } from '../../auth/createAuthSource'
import type { AuthSource } from '../../auth/types'
import { failed, notConnected, ready, type DataProviders, type Insight, type Role } from '../../contracts'
import { createFixtureProviders } from '../../data/fixtures/createFixtureProviders'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { createPreviewAuth } from '../../preview/previewAuth'
import { KPI_SLOTS } from './slots'

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

interface Opts {
  role?: Role
  route?: string
  wrap?: (base: DataProviders) => DataProviders
}

function setup({ role = 'agency_admin', route = '/brands/brand-urinal/overview', wrap }: Opts = {}) {
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

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  document.documentElement.removeAttribute('data-az-theme')
})

const card = (name: string) => screen.getByRole('article', { name })
const loaded = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Overview' })
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Se încarcă' })).toBeNull())
}

describe('Overview: structura din spec cap. 12', () => {
  it('are bara de context, cele 6 KPI, evoluția, ultima analiză, comparația și oportunitățile', async () => {
    setup()
    await loaded()
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(6)
    for (const h of ['Evoluție', 'Ultima analiză publicată', 'Comparație cu competitorii', 'Oportunități']) {
      expect(await screen.findByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
  })

  it('bara de context: brand, țară, perioadă, comparație și acoperirea indicatorilor', async () => {
    setup()
    await loaded()
    const ctx = screen.getByRole('region', { name: 'Context' })
    expect(ctx).toHaveTextContent('Urinal')
    expect(ctx).toHaveTextContent('România')
    expect(ctx).toHaveTextContent(/Perioadă .* - .*\d{4}/)
    expect(ctx).toHaveTextContent(/Comparație .* - .*\d{4}/)
    expect(within(ctx).getByLabelText('Acoperirea indicatorilor')).toBeInTheDocument()
  })

  it('acoperirea indicatorilor numără cele 6 carduri, pe stări', async () => {
    setup()
    await loaded()
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Se încarcă acoperirea' })).toBeNull())
    // Urinal: gsc_clicks parțial, ga4_key_events învechit, ga4_sessions complet; 3 chei din afara registrului: indisponibil.
    expect(screen.getByTestId('cov-complete')).toHaveTextContent('1')
    expect(screen.getByTestId('cov-partial')).toHaveTextContent('1')
    expect(screen.getByTestId('cov-stale')).toHaveTextContent('1')
    expect(screen.getByTestId('cov-unavailable')).toHaveTextContent('3')
  })
})

describe('Overview: cardurile KPI', () => {
  it('etichetele vin din registru când există definiția și din slot când nu', async () => {
    setup()
    await loaded()
    expect(card('Clicks (Search Console)')).toBeInTheDocument() // name_ro din registru
    expect(card('Sesiuni')).toBeInTheDocument()
    expect(card('Key events')).toBeInTheDocument()
    expect(card('AI Mention Rate')).toBeInTheDocument() // slot: nu e în registru
    expect(card('Cost paid')).toBeInTheDocument()
    expect(card('Mențiuni eligibile')).toBeInTheDocument()
  })

  it.each(['AI Mention Rate', 'Cost paid', 'Mențiuni eligibile'])('%s: not_connected, fără cifră, fără definiție inventată', async (name) => {
    setup()
    await loaded()
    const c = card(name)
    expect(within(c).getByText('Sursă neconectată')).toBeInTheDocument()
    expect(within(c).queryByText(/^\d/)).toBeNull()
    expect(c).toHaveAttribute('data-status', 'not_connected')
    await userEvent.click(within(c).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(within(c).getByRole('tooltip')).toHaveTextContent('Definiția acestui indicator nu este încă în registrul de metrici.')
  })

  it('metricile din registru au valoare, variație, sursă, „Date până la" și tooltip cu formula din registru', async () => {
    setup()
    await loaded()
    const c = card('Sesiuni')
    expect(c).toHaveAttribute('data-status', 'ok')
    expect(within(c).getByText('Google Analytics 4')).toBeInTheDocument()
    expect(within(c).getByText(/Date până la/)).toBeInTheDocument()
    expect(within(c).getByText(/^[+−]?\d+(,\d)?\s%$/)).toBeInTheDocument()
    expect(within(c).getByText(/față de .* - .*\d{4}/)).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(within(c).getByRole('tooltip')).toHaveTextContent('Numărul de sesiuni GA4 în perioadă; suma zilelor.')
  })

  it('stările parțial și învechit apar cu motivul lor, nu ca zero', async () => {
    setup()
    await loaded()
    const partial = card('Clicks (Search Console)')
    expect(partial).toHaveAttribute('data-status', 'partial')
    expect(within(partial).getByText('Parțial')).toBeInTheDocument()
    expect(within(partial).getByText(/Date disponibile pentru \d+% din zilele intervalului/)).toBeInTheDocument()
    const stale = card('Key events')
    expect(stale).toHaveAttribute('data-status', 'stale')
    expect(within(stale).getByText('Învechit')).toBeInTheDocument()
    expect(within(stale).getByText(/Ultimele date sunt din/)).toBeInTheDocument()
  })

  it('un card cu sparkline nu desenează nimic pentru o sursă neconectată', async () => {
    setup()
    await loaded()
    expect(card('Cost paid').querySelector('svg[viewBox="0 0 100 32"]')).toBeNull()
  })

  it('perioada și comparația din URL se aplică pe carduri', async () => {
    const { providers } = setup({ route: '/brands/brand-urinal/overview?period=7d' })
    const spy = vi.spyOn(providers.metrics, 'metrics')
    await loaded()
    await waitFor(() => expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ brandId: 'brand-minimartieni' }), expect.anything()))
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument()
  })

  it('brandul curent determină datele: Minimartieni are alte valori decât Urinal', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const c = card('Clicks (Search Console)')
    expect(c).toHaveAttribute('data-status', 'ok')
  })
})

describe('Overview: dovezi (EvidenceDrawer)', () => {
  it('fiecare KPI deschide dovezile: definiție, interval, înregistrări și hash; Esc închide și restituie focusul', async () => {
    setup()
    await loaded()
    const open = within(card('Sesiuni')).getByRole('button', { name: 'Deschide dovezile pentru Sesiuni' })
    await userEvent.click(open)
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(dlg).toHaveTextContent('Overview')
    expect(dlg).toHaveTextContent('Cum se calculează')
    expect(dlg).toHaveTextContent('Numărul de sesiuni GA4 în perioadă; suma zilelor.')
    expect(await within(dlg).findByText(/Cele mai recente 10 din/)).toBeInTheDocument()
    expect(within(dlg).getByText(/[0-9a-f]{16}…/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(open).toHaveFocus()
  })

  it.each(KPI_SLOTS.map((s) => s.label === 'Clicks organic' ? 'Clicks (Search Console)' : s.label))('%s se poate deschide cu tastatura (Enter)', async (name) => {
    setup()
    await loaded()
    within(card(name)).getByRole('button', { name: `Deschide dovezile pentru ${name}` }).focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toBeInTheDocument()
  })

  it('un KPI din afara registrului: „Sursă neconectată", fără valori estimate, cu acțiune doar pentru agency_admin', async () => {
    setup()
    await loaded()
    await userEvent.click(within(card('Cost paid')).getByRole('button', { name: 'Deschide dovezile pentru Cost paid' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect((await within(dlg).findAllByText(/Nu afișăm valori estimate/)).length).toBeGreaterThan(0)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Vezi sursele' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/sources'))
  })

  it('pentru strategist nu apare acțiunea spre Surse', async () => {
    setup({ role: 'strategist' })
    await loaded()
    await userEvent.click(within(card('Cost paid')).getByRole('button', { name: 'Deschide dovezile pentru Cost paid' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    await within(dlg).findAllByText(/Nu afișăm valori estimate/)
    expect(within(dlg).queryByRole('button', { name: 'Vezi sursele' })).toBeNull()
  })

  it('o eroare la dovezi afișează „Reîncearcă" fără să închidă drawerul', async () => {
    let n = 0
    setup({
      wrap: (b) => ({ ...b, metrics: { ...b.metrics, evidence: async (id, q) => (++n === 1 ? failed('Timeout.') : b.metrics.evidence(id, q)) } }),
    })
    await loaded()
    await userEvent.click(within(card('Sesiuni')).getByRole('button', { name: 'Deschide dovezile pentru Sesiuni' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(await within(dlg).findByText('Timeout.')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(dlg).findByText(/Cele mai recente 10 din/)).toBeInTheDocument()
  })
})

describe('Overview: evoluția', () => {
  it('patru serii comutabile, cu AI neconectat (nu o linie la zero)', async () => {
    setup()
    await loaded()
    const tabs = within(await screen.findByRole('tablist', { name: 'Seria afișată' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['AI', 'Search', 'Trafic', 'Mențiuni'])
    expect(await screen.findByText('Sursă neconectată', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByTestId('chart-gap')).toBeNull()
  })

  it('seria Search: grafic cu comparația punctată și zilele fără date hașurate, nu zero', async () => {
    setup()
    await loaded()
    await userEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    const fig = await screen.findByRole('figure', { name: /Evoluție: Clicks \(Search Console\)/ })
    expect(within(fig).getByRole('button', { name: 'Clicks (Search Console)' })).toBeInTheDocument()
    expect(within(fig).getByRole('button', { name: 'Perioada de comparație' })).toBeInTheDocument()
    expect(within(fig).getAllByTestId('chart-gap').length).toBeGreaterThan(0)
    // Linia seriei principale se întrerupe la zilele fără date (două segmente), nu coboară la zero.
    expect((fig.querySelector('svg path')?.getAttribute('d') ?? '').match(/M/g)?.length).toBeGreaterThan(1)
    expect(screen.getByText('Zilele fără date apar hașurate; nu sunt zero.')).toBeInTheDocument()
  })

  it('tabelul alternativ al graficului păstrează „Fără date" pentru zilele lipsă', async () => {
    setup()
    await loaded()
    await userEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vezi ca tabel' }))
    expect(screen.getAllByText('Fără date').length).toBeGreaterThan(0)
  })

  it('seria Trafic: o singură serie cu comparație; Mențiuni neconectat', async () => {
    setup()
    await loaded()
    await userEvent.click(await screen.findByRole('tab', { name: 'Trafic' }))
    expect(await screen.findByRole('figure', { name: /Evoluție: Sesiuni/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Mențiuni' }))
    expect(await screen.findByText('Sursă neconectată', { selector: 'p' })).toBeInTheDocument()
  })

  it('o eroare la serii: mesaj cu „Reîncearcă", iar cardurile și restul paginii rămân', async () => {
    let n = 0
    setup({ wrap: (b) => ({ ...b, metrics: { ...b.metrics, trends: async (c, k) => (++n === 1 ? Promise.reject(new Error('Serii indisponibile.')) : b.metrics.trends(c, k)) } }) })
    await loaded()
    expect(await screen.findByText('Serii indisponibile.')).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(6)
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    await waitFor(() => expect(screen.queryByText('Serii indisponibile.')).toBeNull())
  })
})

describe('Overview: ultima analiză și oportunități', () => {
  it('agenția vede ultima analiză publicată cu badge de status, autor, perioadă și limite', async () => {
    setup()
    await loaded()
    const sec = await screen.findByRole('heading', { level: 2, name: 'Ultima analiză publicată' })
    const region = sec.closest('section')!
    expect(await within(region).findByText('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')).toBeInTheDocument()
    expect(within(region).getByText('Publicat')).toBeInTheDocument()
    expect(within(region).getByText('Ioana Popescu')).toBeInTheDocument()
    expect(within(region).getByText(/Cohortă de 80 de răspunsuri valide/)).toBeInTheDocument()
  })

  it('clientul vede aceeași analiză, fără badge de status', async () => {
    setup({ role: 'client_viewer' })
    await loaded()
    const region = (await screen.findByRole('heading', { level: 2, name: 'Ultima analiză publicată' })).closest('section')!
    expect(await within(region).findByText('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')).toBeInTheDocument()
    expect(within(region).queryByText('Publicat')).toBeNull()
  })

  it('analiza în review sau draft nu apare niciodată ca „ultima publicată"', async () => {
    setup({
      wrap: (b) => ({
        ...b,
        insights: { list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(r.data.filter((i: Insight) => i.status !== 'published')) : r } },
      }),
    })
    await loaded()
    expect(await screen.findByText('Nicio analiză publicată')).toBeInTheDocument()
    expect(screen.queryByText(/Vizibilitatea în răspunsurile AI/)).toBeNull()
  })

  it('„Vezi toate analizele" duce la modul Analize, cu perioada păstrată', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    expect(await screen.findByRole('link', { name: 'Vezi toate analizele' })).toHaveAttribute('href', '/brands/brand-urinal/insights?period=7d')
  })

  it('dovada din analiză deschide EvidenceDrawer cu metrica ei', async () => {
    setup()
    await loaded()
    const region = (await screen.findByRole('heading', { level: 2, name: 'Ultima analiză publicată' })).closest('section')!
    await userEvent.click(await within(region).findByRole('button', { name: 'Clicks din search' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(await within(dlg).findByText('Clicks (Search Console)')).toBeInTheDocument()
  })

  it('oportunități: maximum 3, doar acțiuni deschise, cu responsabil, termen și status, în ordinea termenului', async () => {
    setup()
    await loaded()
    const region = (await screen.findByRole('heading', { level: 2, name: 'Oportunități' })).closest('section')!
    const items = await within(region).findAllByRole('listitem')
    expect(items.length).toBeLessThanOrEqual(3)
    expect(items.map((i) => within(i).getByRole('heading').textContent)).toEqual(['Verifică paginile citate pentru Prevenție ITU', 'Extinde conținutul despre merișor și D-manoză'])
    expect(within(items[0]!).getByText('Andrei Vasile')).toBeInTheDocument()
    expect(within(items[0]!).getByText(/Responsabil, Account manager/)).toBeInTheDocument()
    expect(within(items[0]!).getByText('În lucru')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Deschisă')).toBeInTheDocument()
    expect(within(region).queryByText('Actualizează titlurile paginilor de categorie')).toBeNull() // acțiune finalizată, din analiza înlocuită
  })

  it('„Deschide dovezile" din oportunitate deschide drawerul', async () => {
    setup()
    await loaded()
    const region = (await screen.findByRole('heading', { level: 2, name: 'Oportunități' })).closest('section')!
    await userEvent.click((await within(region).findAllByRole('button', { name: 'Deschide dovezile' }))[0]!)
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toBeInTheDocument()
  })

  it('fără acțiuni deschise: stare goală cu explicație', async () => {
    setup({ route: '/brands/brand-minimartieni/overview', wrap: (b) => ({ ...b, insights: { list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(r.data.map((i) => ({ ...i, actions: [] }))) : r } } }) })
    await loaded()
    expect(await screen.findByText('Nicio oportunitate deschisă')).toBeInTheDocument()
  })

  it('analize indisponibile (provider neconectat): motivul, în ambele secțiuni, fără listă goală', async () => {
    setup({ wrap: (b) => ({ ...b, insights: { list: async () => notConnected('Analizele nu sunt încă disponibile pentru acest brand.') } }) })
    await loaded()
    await waitFor(() => expect(screen.getAllByText('Analizele nu sunt încă disponibile pentru acest brand.')).toHaveLength(2))
  })
})

describe('Overview: comparația cu competitorii', () => {
  it('coloane brand + C1-C3, versiunea setului și data efectivă; competitorii sunt N/A cu motiv, nu 0', async () => {
    setup()
    await loaded()
    const region = (await screen.findByRole('heading', { level: 2, name: 'Comparație cu competitorii' })).closest('section')!
    const table = await within(region).findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Uronova' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Cisticare' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Vitamerin' })).toBeInTheDocument()
    expect(within(region).getByText('v3')).toBeInTheDocument()
    expect(within(region).getByText(/1 sept\.?\s2026/)).toBeInTheDocument()
    expect(within(region).getAllByText(/Nu există încă o sursă de date pentru competitori/).length).toBeGreaterThan(0)
    expect(within(table).queryByText('Cea mai bună valoare:')).toBeNull()
  })

  it('brandul își arată valoarea acolo unde există (SEO) și N/A unde nu există (AI, Listening)', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const region = (await screen.findByRole('heading', { level: 2, name: 'Comparație cu competitorii' })).closest('section')!
    await within(region).findByRole('table')
    const seo = within(region).getByRole('row', { name: /Visibility SEOmonitor/ })
    expect(within(seo).getAllByRole('cell')[0]).not.toHaveTextContent('N/A')
    const ai = within(region).getByRole('row', { name: /AI Mention Rate/ })
    expect(within(ai).getAllByRole('cell')[0]).toHaveTextContent('N/A')
  })

  it('link spre comparația completă, cu perioada păstrată', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    expect(await screen.findByRole('link', { name: 'Toată comparația' })).toHaveAttribute('href', '/brands/brand-urinal/competition?period=7d')
  })

  it('setul de competitori neconfigurat: motivul, nu o tabelă goală', async () => {
    setup({ wrap: (b) => ({ ...b, brands: { ...b.brands, competitorSet: async () => notConnected('Setul de competitori nu e configurat pentru acest brand.') } }) })
    await loaded()
    expect(await screen.findByText('Setul de competitori nu e configurat pentru acest brand.')).toBeInTheDocument()
  })
})

describe('Overview: izolarea secțiunilor și providerul real', () => {
  it('metrici căzute: cardurile arată eroarea cu „Reîncearcă", iar analiza și comparația se încarcă oricum', async () => {
    let n = 0
    // Cade doar cererea cardurilor KPI (prima care conține `ga4_sessions`); comparația cere alte chei.
    setup({ wrap: (b) => ({ ...b, metrics: { ...b.metrics, metrics: async (c, k) => (k.includes('ga4_sessions') && ++n === 1 ? Promise.reject(new Error('Serverul nu a răspuns.')) : b.metrics.metrics(c, k)) } }) })
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    expect((await screen.findAllByText('Nu am putut încărca datele')).length).toBeGreaterThanOrEqual(6)
    expect(await screen.findByText('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Reîncearcă' })[0]!)
    await waitFor(() => expect(screen.queryAllByText('Nu am putut încărca datele')).toHaveLength(0))
  })

  it('cu providerul supabase (neconectat): niciun card nu inventează valori sau definiții', async () => {
    const auth = createPreviewAuth('agency_admin')
    const real = createSupabaseProviders()
    // Brandurile trebuie să existe ca să se deschidă pagina; restul rămâne providerul real, gol.
    const providers: DataProviders = { ...real, brands: createFixtureProviders({}).brands }
    render(
      <MemoryRouter initialEntries={['/brands/brand-urinal/overview']}>
        <App env={{ providers, auth }} />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const grid = await screen.findByTestId('kpi-grid')
    await waitFor(() => expect(within(grid).getAllByText('Sursă neconectată')).toHaveLength(6))
    expect(within(grid).queryByText(/^\d/)).toBeNull()
    expect(within(grid).queryAllByRole('img')).toHaveLength(0)
    await userEvent.click(within(grid).getAllByRole('button', { name: 'Ce înseamnă indicatorul' })[1]!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Definiția acestui indicator nu este încă în registrul de metrici.')
    expect(screen.queryByText(/supabase|stack/i)).toBeNull()
  })

  it('fără sesiune, Overview nu se montează și nu cere date', () => {
    const auth = createUnconfiguredAuth()
    const providers = createFixtureProviders({})
    const spy = vi.spyOn(providers.metrics, 'metrics')
    render(
      <MemoryRouter initialEntries={['/brands/brand-urinal/overview']}>
        <App env={{ providers, auth }} />
      </MemoryRouter>,
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('un brand nepermis nu declanșează nicio cerere de metrici', async () => {
    const { providers } = setup({ route: '/brands/brand-strain/overview' })
    const spy = vi.spyOn(providers.metrics, 'metrics')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})
