import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { createUnconfiguredAuth } from '../../auth/createAuthSource'
import type { AuthSource } from '../../auth/types'
import { failed, notConnected, ready, type DataProviders, type Insight, type MetricItem, type Role } from '../../contracts'
import { createFixtureProviders } from '../../data/fixtures/createFixtureProviders'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { createPreviewAuth } from '../../preview/previewAuth'
import { OVERVIEW_CARDS } from './slots'

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
const section = (name: string) => screen.getByRole('region', { name })
const loaded = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Overview' })
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Se încarcă' })).toBeNull())
}

/** Înlocuiește variațiile venite de la provider, ca semnalele să nu depindă de data rulării. */
const withChanges = (changes: Record<string, Partial<MetricItem>>) => (b: DataProviders): DataProviders => ({
  ...b,
  metrics: {
    ...b.metrics,
    metrics: async (c, k) => {
      const r = await b.metrics.metrics(c, k)
      return { ...r, items: r.items.map((i) => ({ ...i, relative_change: 1, ...(i.value === null ? {} : (changes[i.metric_key] ?? {})) })) }
    },
  },
})

const NAMES = { ai: 'AI Mention Rate', seo: 'Visibility SEOmonitor (ultima observație)', mentions: 'Mențiuni (Planable Listening)', social: 'Interacțiuni (social propriu)', sessions: 'Sesiuni', events: 'Key events' }

describe('Overview: structura din propunerea din 10 nov. 2026', () => {
  it('are starea datelor, bara de context, 6 carduri, „Ce s-a schimbat", evoluția, poziția, prioritățile și interpretarea, în această ordine', async () => {
    setup()
    await loaded()
    expect(screen.getByRole('region', { name: 'Starea datelor' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(6)
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual(['Ce s-a schimbat', 'Evoluția brandului', 'Poziția față de competitori', 'Prioritățile următoare', 'Interpretarea AdSymphony'])
  })

  it('bara de context: client, brand, țară, perioadă, comparație și acoperirea indicatorilor', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=custom&from=2026-09-08&to=2026-10-05' })
    await loaded()
    const bar = screen.getByRole('region', { name: 'Context' })
    expect(bar).toHaveTextContent('Client STADA România')
    expect(bar).toHaveTextContent('Brand Urinal')
    expect(bar).toHaveTextContent('Țară România')
    expect(bar).toHaveTextContent('8 sept. - 5 oct. 2026')
    expect(bar).toHaveTextContent('11 aug. - 7 sept. 2026')
    expect(within(bar).getByLabelText('Acoperirea indicatorilor')).toBeInTheDocument()
  })

  it('acoperirea numără cele cinci metrici din registru, pe stări', async () => {
    setup()
    await loaded()
    const cov = within(screen.getByRole('region', { name: 'Context' })).getByLabelText('Acoperirea indicatorilor')
    const total = ['complete', 'partial', 'stale', 'unavailable'].reduce((n, s) => n + Number(within(cov).queryByTestId(`cov-${s}`)?.textContent ?? 0), 0)
    expect(total).toBe(5)
  })

  it('starea datelor arată sursele modulului cu „date până la" și următoarea actualizare estimată', async () => {
    setup()
    await loaded()
    const strip = screen.getByRole('region', { name: 'Starea datelor' })
    const items = within(within(strip).getByRole('list', { name: 'Date până la, pe sursă' })).getAllByRole('listitem')
    expect(items.map((i) => i.querySelector('span')?.textContent)).toEqual(['SEOmonitor', 'Search Console', 'Google Analytics 4', 'Planable'])
    expect(strip).toHaveTextContent('Următoarea actualizare estimată')
  })
})

describe('Overview: cele șase carduri', () => {
  it('fiecare card răspunde la o întrebare, în ordinea din propunere, cu numele exact al metricii din registru', async () => {
    setup()
    await loaded()
    const cards = within(screen.getByTestId('kpi-grid')).getAllByRole('article')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([NAMES.ai, NAMES.seo, NAMES.mentions, NAMES.social, NAMES.sessions, NAMES.events])
    OVERVIEW_CARDS.forEach((c, i) => expect(cards[i]).toHaveTextContent(c.category))
  })

  it('metricile din registru au valoare, variație, sursă, „Date până la" și tooltip cu formula din registru', async () => {
    setup()
    await loaded()
    const c = card(NAMES.sessions)
    expect(c).toHaveAttribute('data-status', 'ok')
    expect(within(c).getByText(/^\d{1,3}(\.\d{3})*$/)).toBeInTheDocument()
    expect(c).toHaveTextContent('Google Analytics 4')
    expect(c).toHaveTextContent('Date până la')
    expect(c).toHaveTextContent('față de')
    await userEvent.click(within(c).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Numărul de sesiuni GA4 în perioadă; suma zilelor.')
  })

  it.each(OVERVIEW_CARDS.map((c) => [c.category, c.detailLabel, c.module] as const))('„%s" duce la detaliu (%s), cu perioada păstrată', async (category, label, module) => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    await userEvent.click(screen.getByRole('link', { name: `${category}: ${label}` }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/brands/brand-urinal/${module}?period=7d`))
  })

  it('conversații: numărul de mențiuni vine din registru, iar ponderea negativă apare doar din mențiunile revizuite, cu numere absolute', async () => {
    setup()
    await loaded()
    const c = card(NAMES.mentions)
    expect(c).toHaveTextContent('Conversații relevante')
    expect(c).toHaveTextContent('Planable Listening')
    expect(c).toHaveTextContent(/Negativ, după revizuire: \d+ din \d+ \(\d+(,\d)? %\) · \d+ nerevizuite\./)
  })

  it('performanță socială: fără import, „Sursă neconectată" cu motivul; cu date, interacțiunile și ce lipsește față de engagement rate', async () => {
    setup()
    await loaded()
    const none = card(NAMES.social)
    expect(none).toHaveAttribute('data-status', 'not_connected')
    expect(within(none).getByText('Sursă neconectată')).toBeInTheDocument()
    expect(within(none).queryByText(/^\d/)).toBeNull()
  })

  it('performanță socială cu Planable conectat (Minimartieni): valoare din `brand_social`, sursă și nota despre engagement rate', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const c = card(NAMES.social)
    expect(within(c).getByText(/^\d{1,3}(\.\d{3})*$/)).toBeInTheDocument()
    expect(c).toHaveTextContent('Planable')
    expect(c).toHaveTextContent('Engagement rate nu are încă definiție în registru; până atunci arătăm interacțiunile.')
  })

  it('acțiuni importante: spune că e număr de evenimente, nu rata sesiunilor cu key event', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    expect(card(NAMES.events)).toHaveTextContent('Număr de evenimente, nu de sesiuni: rata sesiunilor cu key event nu se colectează încă.')
  })

  it('stările parțial, învechit și neconectat apar cu motivul lor, nu ca zero', async () => {
    setup()
    await loaded()
    expect(card(NAMES.ai)).toHaveAttribute('data-status', 'partial')
    expect(card(NAMES.ai)).toHaveTextContent(/Date disponibile pentru \d+% din zilele intervalului/)
    expect(card(NAMES.ai)).toHaveTextContent('Definiție provizorie')
    expect(card(NAMES.events)).toHaveAttribute('data-status', 'stale')
    expect(card(NAMES.events)).toHaveTextContent(/Ultimele date sunt din/)
    const seo = card(NAMES.seo)
    expect(seo).toHaveAttribute('data-status', 'not_connected')
    expect(within(seo).getByText('Sursă neconectată')).toBeInTheDocument()
    expect(within(seo).queryByText(/^\d/)).toBeNull()
  })

  it('perioada din URL se aplică pe carduri, iar brandul curent determină datele', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    const week = within(card(NAMES.sessions)).getByText(/^\d{1,3}(\.\d{3})*$/).textContent
    await userEvent.click(screen.getByRole('link', { name: 'Trafic pe site: Canale și landing pages' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/traffic?period=7d'))
    expect(week).toBeTruthy()
  })

  it('Minimartieni are alte valori decât Urinal', async () => {
    const a = setup()
    await loaded()
    const urinal = within(card(NAMES.sessions)).getByText(/^\d{1,3}(\.\d{3})*$/).textContent
    expect(a.providers.kind).toBe('fixtures')
    const other = (await a.providers.metrics.metrics({ brandId: 'brand-minimartieni', period: { preset: '28d', from: '2026-09-08', to: '2026-10-05' }, comparison: 'previous', filters: {} }, ['ga4_sessions'])).items[0]
    expect(String(other?.value)).not.toBe(urinal?.replace(/\./g, ''))
  })
})

describe('Overview: „Ce s-a schimbat"', () => {
  it('oportunitatea și riscul sunt cele mai mari variații, favorabilă și nefavorabilă, etichetate ca semnale automate neconfirmate', async () => {
    setup({ wrap: withChanges({ ga4_sessions: { relative_change: 12.9, status: 'ok' }, ai_mention_rate: { relative_change: -9, absolute_change: -3.8, status: 'ok' } }) })
    await loaded()
    const list = within(section('Ce s-a schimbat')).getAllByRole('listitem')
    expect(list.map((l) => l.getAttribute('aria-label'))).toEqual(['Oportunitate', 'Risc', 'Decizie'])
    expect(list[0]).toHaveTextContent('Sesiuni: +12,9 %')
    expect(list[0]).toHaveTextContent('Google Analytics 4')
    expect(list[0]).toHaveTextContent('Semnal automat, neconfirmat')
    expect(list[0]).toHaveTextContent('Față de')
    expect(list[1]).toHaveTextContent('AI Mention Rate: −3,8 p.p.')
    expect(list[1]).toHaveTextContent('SEOmonitor')
  })

  it('un semnal pe date parțiale o spune; „Vezi dovada" deschide dovezile metricii', async () => {
    setup({ wrap: withChanges({ ai_mention_rate: { relative_change: 20, absolute_change: 6 } }) })
    await loaded()
    const opp = within(section('Ce s-a schimbat')).getByRole('listitem', { name: 'Oportunitate' })
    expect(opp).toHaveTextContent('Semnal automat, pe date parțiale')
    await userEvent.click(within(opp).getByRole('button', { name: 'Vezi dovada' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(dlg).toHaveTextContent('AI Mention Rate')
  })

  it('fără variații de cel puțin 5 %, nu se inventează semnale', async () => {
    setup({ wrap: withChanges({}) })
    await loaded()
    const s = section('Ce s-a schimbat')
    expect(within(s).getByRole('listitem', { name: 'Oportunitate' })).toHaveTextContent('Niciun indicator principal nu are o variație favorabilă de cel puțin 5 % în acest interval.')
    expect(within(s).getByRole('listitem', { name: 'Risc' })).toHaveTextContent('Niciun indicator principal nu are o variație nefavorabilă de cel puțin 5 % în acest interval.')
  })

  it('decizia vine din ultima analiză publicată: prima acțiune deschisă, cu responsabil și termen', async () => {
    setup()
    await loaded()
    const d = within(section('Ce s-a schimbat')).getByRole('listitem', { name: 'Decizie' })
    expect(d).toHaveTextContent('Verifică paginile citate pentru Prevenție ITU')
    expect(d).toHaveTextContent('Andrei Vasile')
    expect(d).toHaveTextContent('Din analiza publicată de AdSymphony')
  })

  it('fără analize disponibile, decizia rămâne goală, cu explicație', async () => {
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async () => notConnected('Analizele vor fi disponibile după configurarea fluxului editorial.') } }) })
    await loaded()
    expect(within(section('Ce s-a schimbat')).getByRole('listitem', { name: 'Decizie' })).toHaveTextContent('Nicio acțiune deschisă în ultima analiză publicată.')
  })
})

describe('Overview: dovezi (EvidenceDrawer)', () => {
  it('un card deschide dovezile: definiție, interval, înregistrări și hash; Esc închide și restituie focusul', async () => {
    setup()
    await loaded()
    const open = within(card(NAMES.sessions)).getByRole('button', { name: 'Deschide dovezile pentru Sesiuni' })
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

  it.each([NAMES.ai, NAMES.seo, NAMES.mentions, NAMES.sessions, NAMES.events])('%s se poate deschide cu tastatura (Enter)', async (name) => {
    setup()
    await loaded()
    within(card(name)).getByRole('button', { name: `Deschide dovezile pentru ${name}` }).focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toBeInTheDocument()
  })

  it('o sursă neconectată: „Sursă neconectată", fără valori estimate, cu acțiune spre surse doar pentru agency_admin', async () => {
    setup()
    await loaded()
    await userEvent.click(within(card(NAMES.seo)).getByRole('button', { name: `Deschide dovezile pentru ${NAMES.seo}` }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect((await within(dlg).findAllByText(/Nu afișăm valori estimate/)).length).toBeGreaterThan(0)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Vezi sursele' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/clients/brand-urinal'))
  })

  it('pentru strategist nu apare acțiunea spre Surse', async () => {
    setup({ role: 'strategist' })
    await loaded()
    await userEvent.click(within(card(NAMES.seo)).getByRole('button', { name: `Deschide dovezile pentru ${NAMES.seo}` }))
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
    await userEvent.click(within(card(NAMES.sessions)).getByRole('button', { name: 'Deschide dovezile pentru Sesiuni' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(await within(dlg).findByText('Timeout.')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(dlg).findByText(/Cele mai recente 10 din/)).toBeInTheDocument()
  })
})

describe('Overview: evoluția brandului', () => {
  it('patru grafice pe aceeași perioadă, câte unul pentru AI, search, trafic și mențiuni, fără scări suprapuse', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=custom&from=2026-09-08&to=2026-10-05' })
    await loaded()
    const s = section('Evoluția brandului')
    expect(s).toHaveTextContent('Aceeași perioadă pentru toate graficele: 8 sept. - 5 oct. 2026.')
    expect(within(s).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['AI · AI Mention Rate', 'Search · Clicks (Search Console)', 'Trafic · Sesiuni', 'Mențiuni · Mențiuni (Planable Listening)'])
    // Fiecare grafic are doar seria lui și comparația: nicio serie cu altă unitate pe aceeași axă.
    for (const key of ['ai_mention_rate', 'gsc_clicks', 'ga4_sessions', 'mentions_count']) {
      const legend = within(screen.getByTestId(`trend-${key}`)).getAllByRole('button', { pressed: true })
      expect(legend).toHaveLength(2)
      expect(legend[1]).toHaveTextContent('Perioada de comparație')
    }
  })

  it('zilele fără date sunt goluri marcate, nu zero; tabelul alternativ păstrează „Fără date"', async () => {
    setup()
    await loaded()
    const search = screen.getByTestId('trend-gsc_clicks')
    expect(search).toHaveTextContent('Zilele fără date apar hașurate; nu sunt zero.')
    await userEvent.click(within(search).getByRole('button', { name: 'Vezi ca tabel' }))
    expect(within(search).getAllByText('Fără date').length).toBeGreaterThan(0)
  })

  it('o serie fără sursă arată „Sursă neconectată", nu o linie la zero (Proenzi, mențiuni)', async () => {
    setup({ route: '/brands/brand-proenzi/overview' })
    await loaded()
    const m = screen.getByTestId('trend-mentions_count')
    expect(within(m).getByText('Sursă neconectată')).toBeInTheDocument()
    expect(within(m).queryByRole('img')).toBeNull()
  })

  it('o eroare la serii: mesaj cu „Reîncearcă" în fiecare grafic, iar cardurile și restul paginii rămân', async () => {
    let n = 0
    setup({ wrap: (b) => ({ ...b, metrics: { ...b.metrics, trends: async (c, k) => (++n === 1 ? Promise.reject(new Error('Seriile nu au putut fi încărcate.')) : b.metrics.trends(c, k)) } }) })
    await loaded()
    const s = section('Evoluția brandului')
    expect(await within(s).findAllByText('Seriile nu au putut fi încărcate.')).toHaveLength(4)
    expect(within(card(NAMES.sessions)).getByText(/^\d{1,3}(\.\d{3})*$/)).toBeInTheDocument()
    await userEvent.click(within(s).getAllByRole('button', { name: 'Reîncearcă' })[0]!)
    await waitFor(() => expect(within(s).queryByText('Seriile nu au putut fi încărcate.')).toBeNull())
  })
})

describe('Overview: poziția față de competitori', () => {
  it('brand + C1-C3 pe AI, SEO și conversații, din aceeași matrice ca pagina Concurență, cu versiunea setului', async () => {
    setup()
    await loaded()
    const s = section('Poziția față de competitori')
    const table = within(s).getByRole('table', { name: 'Poziția față de competitori' })
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent ?? '')
    for (const h of ['Metrică', 'Urinal', 'C1', 'C2', 'C3']) expect(heads.some((t) => t.includes(h)), h).toBe(true)
    expect(s).toHaveTextContent('Set de competitori v3')
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3)
    expect(table).toHaveTextContent('Mention Rate')
    expect(table).toHaveTextContent('Keywords în Top 10')
    expect(table).toHaveTextContent('Mențiuni eligibile')
  })

  it('locul în set se afișează separat pe fiecare dimensiune; fără scor general', async () => {
    setup()
    await loaded()
    const ranks = within(section('Poziția față de competitori')).getByRole('list', { name: 'Locul în set, pe dimensiune' })
    const items = within(ranks).getAllByRole('listitem').map((i) => i.textContent)
    expect(items[0]).toMatch(/^AI locul \d din 4$/)
    expect(items[1]).toMatch(/^SEO locul \d din 4$/)
    expect(items[2]).toMatch(/^Listening fără clasament: /)
    expect(screen.queryByText(/scor de brand|scor general/i)).toBeNull()
  })

  it('competitorii fără sursă rămân N/A cu motiv, nu 0', async () => {
    setup()
    await loaded()
    const s = section('Poziția față de competitori')
    expect(within(s).getAllByText('N/A').length).toBeGreaterThanOrEqual(3)
    expect(s).toHaveTextContent('Pentru competitori nu există sursă de Listening conectată.')
  })

  it('link spre comparația completă, cu perioada păstrată', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    await userEvent.click(screen.getByRole('link', { name: 'Toată comparația' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/brands/brand-urinal/competition?period=7d'))
  })

  it('setul de competitori neconfigurat: motivul, nu o tabelă goală', async () => {
    setup({ wrap: (b) => ({ ...b, competition: { ...b.competition, matrix: async () => notConnected('Setul de competitori nu e configurat pentru acest brand.') } }) })
    await loaded()
    const s = section('Poziția față de competitori')
    expect(await within(s).findByText('Setul de competitori nu e configurat pentru acest brand.')).toBeInTheDocument()
    expect(within(s).queryByRole('table')).toBeNull()
  })
})

describe('Overview: prioritățile următoare și interpretarea AdSymphony', () => {
  const published = 'Vizibilitatea în răspunsurile AI scade pe criteriile de alegere'

  it('agenția vede ultima analiză publicată cu badge de status, autor, perioadă, data publicării și limite', async () => {
    setup()
    await loaded()
    const c = await screen.findByRole('article', { name: published })
    expect(within(c).getByText('Publicat')).toBeInTheDocument()
    expect(c).toHaveTextContent('Ioana Popescu')
    expect(c).toHaveTextContent('Publicată la')
    expect(c).toHaveTextContent('Limite:')
  })

  it('clientul vede aceeași analiză, fără badge de status', async () => {
    setup({ role: 'client_viewer' })
    await loaded()
    const c = await screen.findByRole('article', { name: published })
    expect(within(c).queryByText('Publicat')).toBeNull()
  })

  it('analiza în review sau draft nu apare niciodată ca interpretare publicată', async () => {
    const drafts = (list: Insight[]): Insight[] => list.map((i) => ({ ...i, status: i.status === 'published' ? 'in_review' : i.status, published_at: null }))
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(drafts(r.data)) : r } } }) })
    await loaded()
    expect(await screen.findByText('Nicio analiză publicată')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: published })).toBeNull()
  })

  it('„Vezi toate analizele" duce la modul Analize, cu perioada păstrată', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    await userEvent.click(screen.getByRole('link', { name: 'Vezi toate analizele' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/brands/brand-urinal/insights?period=7d'))
  })

  it('dovada din analiză deschide EvidenceDrawer cu metrica ei', async () => {
    setup()
    await loaded()
    const c = await screen.findByRole('article', { name: published })
    await userEvent.click(within(c).getByRole('button', { name: 'Clicks din search' }))
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toHaveTextContent('Clicks')
  })

  it('priorități: maximum 3, doar acțiuni deschise, cu responsabil, termen și status, în ordinea termenului', async () => {
    setup()
    await loaded()
    const items = within(section('Prioritățile următoare')).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(3)
    expect(items[0]).toHaveTextContent('Verifică paginile citate pentru Prevenție ITU')
    expect(items[0]).toHaveTextContent('În lucru')
    expect(items[0]).toHaveTextContent('Andrei Vasile')
    expect(items[0]).toHaveTextContent('Termen')
    for (const i of items) expect(i).not.toHaveTextContent(/Finalizată|Anulată/)
  })

  it('efortul și KPI-ul urmărit apar doar când au fost completate', async () => {
    const withPlan = (list: Insight[]): Insight[] => list.map((i) => ({ ...i, actions: i.actions.map((a, n) => (n === 0 ? { ...a, effort: '2 zile', tracked_metric: { metric_key: 'ai_mention_rate', label: 'AI Mention Rate' } } : a)) }))
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(withPlan(r.data)) : r } } }) })
    await loaded()
    const items = within(section('Prioritățile următoare')).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Efort2 zile')
    expect(items[0]).toHaveTextContent('KPI urmăritAI Mention Rate')
    if (items[1]) expect(items[1]).not.toHaveTextContent('Efort')
  })

  it('„Deschide dovezile" dintr-o prioritate deschide drawerul', async () => {
    setup()
    await loaded()
    await userEvent.click(within(section('Prioritățile următoare')).getAllByRole('button', { name: 'Deschide dovezile' })[0]!)
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toBeInTheDocument()
  })

  it('fără acțiuni deschise: stare goală cu explicație', async () => {
    const closed = (list: Insight[]): Insight[] => list.map((i) => ({ ...i, actions: i.actions.map((a) => ({ ...a, status: 'done' as const })) }))
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(closed(r.data)) : r } } }) })
    await loaded()
    expect(await screen.findByText('Nicio prioritate deschisă')).toBeInTheDocument()
  })

  it('analize indisponibile (provider neconectat): motivul, în ambele secțiuni, fără listă goală', async () => {
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async () => notConnected('Analizele vor fi disponibile după configurarea fluxului editorial.') } }) })
    await loaded()
    expect(await screen.findAllByText('Analizele vor fi disponibile după configurarea fluxului editorial.')).toHaveLength(2)
  })
})

describe('Overview: izolarea secțiunilor și providerul real', () => {
  it('metrici căzute: cardurile arată eroarea cu „Reîncearcă", iar analiza și poziția se încarcă oricum', async () => {
    let n = 0
    setup({ wrap: (b) => ({ ...b, metrics: { ...b.metrics, metrics: async (c, k) => (++n === 1 ? Promise.reject(new Error('Serverul nu a răspuns.')) : b.metrics.metrics(c, k)) } }) })
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const grid = await screen.findByTestId('kpi-grid')
    await waitFor(() => expect(within(grid).getAllByText('Nu am putut încărca datele')).toHaveLength(5))
    expect(await screen.findByText('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')).toBeInTheDocument()
    expect(await within(section('Poziția față de competitori')).findByRole('table')).toBeInTheDocument()
    await userEvent.click(within(grid).getAllByRole('button', { name: 'Reîncearcă' })[0]!)
    await waitFor(() => expect(within(grid).queryAllByText('Nu am putut încărca datele')).toHaveLength(0))
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
    expect(within(section('Ce s-a schimbat')).queryByText(/Semnal automat/)).toBeNull()
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
