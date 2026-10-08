import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failed } from '../../contracts'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp, where } from '../../test/renderApp'

const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const ROUTE = '/brands/brand-urinal/seo'
const open = () => pageReady('SEO și Search')
const kwRows = () => within(within(section('Keywords urmărite')).getByRole('table')).getAllByRole('row').slice(1)

describe('SEO și Search: KPI din registru', () => {
  it('cele 6 carduri, cu etichetele din registru când există definiția', async () => {
    renderApp({ route: ROUTE })
    await open()
    const grid = screen.getByTestId('kpi-grid')
    expect(within(grid).getAllByRole('article')).toHaveLength(6)
    for (const n of ['Clicks (Search Console)', 'Impressions (Search Console)', 'CTR (Search Console)', 'Visibility SEOmonitor (ultima observație)', 'Keywords în Top 3', 'Keywords în Top 10']) {
      expect(within(grid).getByRole('article', { name: n })).toBeInTheDocument()
    }
  })

  it('stările parțial, învechit și neconectat, cu definiția din registru chiar și când sursa lipsește', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(screen.getByRole('article', { name: 'CTR (Search Console)' })).toHaveAttribute('data-status', 'partial')
    expect(screen.getByRole('article', { name: 'Impressions (Search Console)' })).toHaveAttribute('data-status', 'stale')
    const vis = screen.getByRole('article', { name: 'Visibility SEOmonitor (ultima observație)' })
    expect(vis).toHaveAttribute('data-status', 'not_connected')
    expect(within(vis).getByText('Sursă neconectată')).toBeInTheDocument()
    await userEvent.click(within(vis).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(within(vis).getByRole('tooltip')).toHaveTextContent('Ultima valoare de visibility raportată de SEOmonitor')
    expect(within(vis).getByText('ultima observație')).toBeInTheDocument()
  })

  it('CTR-ul e în procente, iar variația lui în puncte procentuale', async () => {
    renderApp({ route: ROUTE })
    await open()
    const c = screen.getByRole('article', { name: 'CTR (Search Console)' })
    expect(within(c).getByText(/^\d+(,\d)?\s%$/)).toBeInTheDocument()
    expect(within(c).getByText(/p\.p\./)).toBeInTheDocument()
  })

  it('Proenzi: CTR-ul fără numitor e „Nu se poate calcula", nu 0', async () => {
    renderApp({ route: '/brands/brand-proenzi/seo' })
    await open()
    const c = screen.getByRole('article', { name: 'CTR (Search Console)' })
    expect(within(c).getByText('Nu se poate calcula')).toBeInTheDocument()
    expect(within(c).queryByText(/^0/)).toBeNull()
  })

  it('un KPI deschide EvidenceDrawer cu pagina „SEO și Search"', async () => {
    renderApp({ route: ROUTE })
    await open()
    await userEvent.click(within(screen.getByRole('article', { name: 'Clicks (Search Console)' })).getByRole('button', { name: /Deschide dovezile/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(dlg).toHaveTextContent('SEO și Search')
    expect(await within(dlg).findByText(/Cele mai recente 10 din/)).toBeInTheDocument()
  })
})

describe('SEO și Search: tabelul de keywords', () => {
  it('coloanele din spec și 8 rânduri pe pagină din 12', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Keywords urmărite')
    for (const h of ['Keyword', 'Volum', 'Rank mobil', 'Rank desktop', 'Trend mobil', 'Competitor prezent']) expect(within(s).getByRole('columnheader', { name: new RegExp(h) })).toBeInTheDocument()
    expect(kwRows()).toHaveLength(8)
    expect(within(s).getByText('1-8 din 12')).toBeInTheDocument()
  })

  it('rank absent e „Fără rank", niciodată 100', async () => {
    renderApp({ route: ROUTE })
    await open()
    await userEvent.click(within(section('Keywords urmărite')).getByRole('button', { name: 'Înainte' }))
    const s = section('Keywords urmărite')
    expect(within(s).getAllByText('Fără rank').length).toBeGreaterThan(0)
    expect(within(s).queryByText(/^100$/)).toBeNull()
    expect(within(s).queryByText('Peste 100')).toBeNull()
  })

  it('sortare după rank mobil: crescător cu „Fără rank" la sfârșit, și în sens descrescător', async () => {
    renderApp({ route: '/brands/brand-minimartieni/seo' })
    await open()
    const s = section('Keywords urmărite')
    const th = within(s).getByRole('columnheader', { name: /Rank mobil/ })
    await userEvent.click(within(th).getByRole('button'))
    let cells = kwRows().map((r) => within(r).getAllByRole('cell')[2]!.textContent)
    expect(cells).toEqual(['1', '1', '3', '7', '11', 'Fără rank'])
    await userEvent.click(within(th).getByRole('button'))
    cells = kwRows().map((r) => within(r).getAllByRole('cell')[2]!.textContent)
    expect(cells).toEqual(['11', '7', '3', '1', '1', 'Fără rank'])
  })

  it('competitorul prezent cu numele din set, eticheta și poziția; „Niciun competitor prezent" când lipsește', async () => {
    renderApp({ route: ROUTE })
    await open()
    const rows = kwRows()
    expect(within(rows[3]!).getByText(/Uronova/)).toBeInTheDocument() // „urinal pret": C1 pe poziția 2
    expect(within(rows[3]!).getByText(/poziția 2/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Niciun competitor prezent')).toBeInTheDocument()
  })

  it('trendul are text pentru cititoare de ecran (poziții câștigate / pierdute) și „—" fără comparație', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Keywords urmărite')
    expect(within(s).getAllByText(/poziții câștigate/).length).toBeGreaterThan(0)
    expect(within(s).getAllByText(/poziții pierdute/).length).toBeGreaterThan(0)
    await userEvent.click(within(s).getByRole('button', { name: 'Înainte' }))
    expect(within(s).getAllByTitle('Fără comparație').length).toBeGreaterThan(0)
  })

  it('URL-ul partajat între branduri e marcat', async () => {
    renderApp({ route: ROUTE })
    await open()
    await userEvent.click(within(section('Keywords urmărite')).getByRole('button', { name: 'Înainte' }))
    expect(within(section('Keywords urmărite')).getByText('URL partajat')).toBeInTheDocument()
  })

  it('volumul se afișează formatat, cu data furnizorului în tooltip', async () => {
    renderApp({ route: ROUTE })
    await open()
    const cell = within(kwRows()[0]!).getAllByRole('cell')[1]!
    expect(cell).toHaveTextContent('5.400')
    expect(cell.querySelector('[title^="Volum furnizor"]')).not.toBeNull()
  })

  it('filtrul brand/nonbrand vine din URL și din meniu', async () => {
    renderApp({ route: `${ROUTE}?kw=brand` })
    await open()
    expect(within(await screen.findByRole('group', { name: 'Filtre active' })).getByText('Keywords: Brand')).toBeInTheDocument()
    await waitFor(() => expect(kwRows()).toHaveLength(4))
    await userEvent.click(screen.getByRole('button', { name: 'Keywords' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Nonbrand' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/seo?kw=nonbrand'))
    await waitFor(() => expect(kwRows()).toHaveLength(8))
    expect(within(section('Keywords urmărite')).queryByRole('navigation', { name: 'Paginare' })).toBeNull()
  })

  it('o valoare necunoscută a filtrului e ignorată', async () => {
    renderApp({ route: `${ROUTE}?kw=evil` })
    await open()
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
    expect(within(section('Keywords urmărite')).getByText('1-8 din 12')).toBeInTheDocument()
  })

  it('niciun keyword pentru filtru: stare goală explicată', async () => {
    renderApp({ route: `${ROUTE}?kw=brand`, wrap: (b) => ({ ...b, search: { ...b.search, keywords: async () => ({ kind: 'ready', data: [] }) } }) })
    await open()
    expect(await within(section('Keywords urmărite')).findByText('Niciun keyword pentru filtrele alese.')).toBeInTheDocument()
  })
})

describe('SEO și Search: landing pages', () => {
  it('rânduri cu clicks, impressions, CTR, poziție; „Nemapat" pentru key events nevalidate, nu 0', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Landing pages din search')
    const rows = within(within(s).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    const byUrl = (u: string) => rows.find((r) => within(r).queryByText(u) !== null)!
    expect(within(byUrl('/sfaturi/infectia-urinara')).getByText('Nemapat')).toBeInTheDocument()
    expect(within(byUrl('/produse/urinal-akut')).queryByText('Nemapat')).toBeNull()
    expect(within(byUrl('/despre-stada')).getByText('URL partajat')).toBeInTheDocument()
    expect(within(byUrl('/')).getAllByRole('cell')[3]).toHaveTextContent(/\d+(,\d)?\s%/)
  })

  it('se sortează după clicks', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Landing pages din search')
    const th = within(s).getByRole('columnheader', { name: /Clicks/ })
    await userEvent.click(within(th).getByRole('button'))
    const vals = within(within(s).getByRole('table')).getAllByRole('row').slice(1).map((r) => Number(within(r).getAllByRole('cell')[1]!.textContent!.replace(/\./g, '')))
    expect(vals).toEqual([...vals].sort((a, b) => a - b))
  })
})

describe('SEO și Search: content gaps', () => {
  it('căutări cu volum formatat, competitor cu nume și poziție', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Content gaps')
    expect(within(s).getAllByRole('listitem')).toHaveLength(4)
    expect(within(s).getByText('d-manoza sau merisor').closest('li')).toHaveTextContent(/2\.400 căutări pe lună/)
    expect(within(s).getByText('d-manoza sau merisor').closest('li')).toHaveTextContent(/Cisticare.*C2.*poziția 4/)
    expect(within(s).getByText(/iar Urinal nu are pagină/)).toBeInTheDocument()
  })
})

describe('SEO și Search: izolarea secțiunilor și providerul real', () => {
  it('keywords căzute: mesaj cu „Reîncearcă", iar landing pages și content gaps se încarcă', async () => {
    let n = 0
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, search: { ...b.search, keywords: async (c, f) => (++n === 1 ? failed('Furnizor indisponibil.') : b.search.keywords(c, f)) } }) })
    await screen.findByRole('heading', { level: 1, name: 'SEO și Search' })
    expect(await screen.findByText('Furnizor indisponibil.')).toBeInTheDocument()
    expect(within(await screen.findByRole('heading', { level: 2, name: 'Content gaps' }).then((h) => h.closest('section')!)).getAllByRole('listitem').length).toBeGreaterThan(0)
    await userEvent.click(within(section('Keywords urmărite')).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(section('Keywords urmărite')).findByRole('table')).toBeInTheDocument()
  })

  it('cu providerul real (neconectat), listele explică lipsa sursei', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, search: createSupabaseProviders().search }) })
    await open()
    await waitFor(() => expect(screen.getAllByText('Datele de search nu sunt încă disponibile pentru acest brand.')).toHaveLength(3))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('un brand nepermis nu declanșează nicio cerere de search', async () => {
    const { providers } = renderApp({ route: '/brands/brand-strain/seo' })
    const spy = vi.spyOn(providers.search, 'keywords')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('o singură cerere pe secțiune (filtrul „keywords" nu reia restul)', async () => {
    const calls = { kw: 0, pages: 0, gaps: 0 }
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, search: { keywords: async (c, f) => (calls.kw++, b.search.keywords(c, f)), landingPages: async (c) => (calls.pages++, b.search.landingPages(c)), contentGaps: async (c) => (calls.gaps++, b.search.contentGaps(c)) } }) })
    await open()
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toEqual({ kw: 1, pages: 1, gaps: 1 })
  })

  it('rolul client vede aceleași date de search (nu există diferențe pe rol aici)', async () => {
    renderApp({ route: ROUTE, role: 'client_viewer' })
    await open()
    expect(kwRows()).toHaveLength(8)
  })
})
