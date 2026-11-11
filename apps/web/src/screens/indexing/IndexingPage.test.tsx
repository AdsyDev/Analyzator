import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { failed, notConnected, ready, type IndexStatus } from '../../contracts'
import { pageReady, renderApp } from '../../test/renderApp'

const ROUTE = '/brands/brand-urinal/indexing'
const open = () => pageReady('Indexare')
const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!

const STATUS: IndexStatus = {
  inspected_on: '2026-11-10',
  summary: { total: 3, indexed: 1, not_indexed: 1, unknown: 1, canonical_mismatch: 1 },
  urls: [
    { url: 'https://urinal.example/a', priority: true, state: 'indexed', verdict: 'PASS', coverage_state: 'Trimisă și indexată', indexing_state: 'INDEXING_ALLOWED', robots_txt_state: 'ALLOWED', page_fetch_state: 'SUCCESSFUL', crawled_as: 'MOBILE', last_crawl_time: '2026-11-08T04:00:00+00:00', google_canonical: 'https://urinal.example/a-canonic', user_canonical: 'https://urinal.example/a', canonical_matches: false, inspected_on: '2026-11-10' },
    { url: 'https://urinal.example/b', priority: false, state: 'not_indexed', verdict: 'NEUTRAL', coverage_state: 'Accesată cu crawlere, momentan neindexată', indexing_state: null, robots_txt_state: null, page_fetch_state: null, crawled_as: null, last_crawl_time: null, google_canonical: null, user_canonical: null, canonical_matches: null, inspected_on: '2026-11-10' },
    { url: 'javascript:alert(1)', priority: false, state: 'unknown', verdict: null, coverage_state: null, indexing_state: null, robots_txt_state: null, page_fetch_state: null, crawled_as: null, last_crawl_time: null, google_canonical: null, user_canonical: null, canonical_matches: null, inspected_on: '2026-11-10' },
  ],
  priority_urls: [{ id: 'p1', url: 'https://urinal.example/a', inspected: true }, { id: 'p2', url: 'https://urinal.example/nou', inspected: false }],
}
const withStatus = (s: IndexStatus) => (b: Parameters<NonNullable<Parameters<typeof renderApp>[0]['wrap']>>[0]) => ({ ...b, search: { ...b.search, indexStatus: async () => ready(s) } })

describe('Indexare', () => {
  it('e în meniu sub SEO și nu are bară de perioadă (arată ultima stare, nu o perioadă)', async () => {
    renderApp({ route: ROUTE })
    await open()
    const nav = screen.getByRole('navigation', { name: 'Module' })
    expect(within(nav).getByRole('link', { name: 'Indexare' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('region', { name: 'Filtre' })).toBeNull()
  })

  it('numărul de URL-uri pe stări, cu ziua inspecției; numerele sunt ale listei inspectate', async () => {
    renderApp({ route: ROUTE, wrap: withStatus(STATUS) })
    await open()
    const s = section('Starea indexării')
    expect(s.textContent).toMatch(/După inspecția din 10 nov\. 2026/)
    expect(s.textContent).toMatch(/nu din tot site-ul/)
    const tile = (label: string) => within(s).getByText(label).parentElement!
    expect(tile('URL-uri inspectate')).toHaveTextContent('3')
    expect(tile('În index')).toHaveTextContent('1')
    expect(tile('În afara indexului')).toHaveTextContent('1')
    expect(tile('Stare necunoscută')).toHaveTextContent('1')
    expect(tile('Canonical diferit')).toHaveTextContent('1')
  })

  it('tabelul: starea de pe server, motivul Google neschimbat, lipsa ca lipsă; un URL nesigur nu devine link', async () => {
    renderApp({ route: ROUTE, wrap: withStatus(STATUS) })
    await open()
    const table = within(section('URL-uri inspectate')).getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    const [a, b, c] = rows as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(a).getByRole('link', { name: 'https://urinal.example/a' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(a).toHaveTextContent('În index')
    expect(a).toHaveTextContent('Trimisă și indexată')
    expect(a).toHaveTextContent('Diferit')
    expect(a).toHaveTextContent('https://urinal.example/a-canonic')
    expect(b).toHaveTextContent('În afara indexului')
    expect(within(b).getAllByText('Fără date').length).toBeGreaterThan(0)
    expect(b).toHaveTextContent('Necunoscut')
    expect(within(c).queryByRole('link')).toBeNull()
    expect(c).toHaveTextContent('Necunoscut')
    expect(within(section('URL-uri inspectate')).getByRole('button', { name: 'Exportă CSV: URL-uri inspectate' })).toBeInTheDocument()
  })

  it('fără nicio inspecție: explicația, nu zerouri', async () => {
    renderApp({ route: ROUTE, wrap: withStatus({ inspected_on: null, summary: { total: 0, indexed: 0, not_indexed: 0, unknown: 0, canonical_mismatch: 0 }, urls: [], priority_urls: [] }) })
    await open()
    expect(within(section('Starea indexării')).getByText('Nicio inspecție încă')).toBeInTheDocument()
    expect(within(section('Starea indexării')).queryByText('În index')).toBeNull()
    expect(within(section('URL-uri inspectate')).getByText('Niciun URL inspectat încă.')).toBeInTheDocument()
    expect(within(section('URL-uri prioritare')).getByText(/Niciun URL prioritar/)).toBeInTheDocument()
  })

  it('Search Console neconectat: „Sursă neconectată”, fără tabel', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, search: { ...b.search, indexStatus: async () => notConnected('Search Console nu este conectat pentru acest brand.') } }) })
    await open()
    expect(await screen.findByText('Search Console nu este conectat pentru acest brand.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('agenția adaugă și șterge URL-uri prioritare; cel adăugat apare ca neinspectat', async () => {
    renderApp({ route: ROUTE, role: 'strategist' })
    await open()
    const s = section('URL-uri prioritare')
    const before = within(within(s).getByRole('list', { name: 'URL-uri prioritare' })).getAllByRole('listitem').length
    await userEvent.type(within(s).getByLabelText('Adaugă un URL prioritar'), 'urinal.example/fara-schema')
    await userEvent.click(within(s).getByRole('button', { name: 'Adaugă' }))
    expect(await within(s).findByRole('alert')).toHaveTextContent('Adresa trebuie să înceapă cu http:// sau https://')
    await userEvent.clear(within(s).getByLabelText('Adaugă un URL prioritar'))
    await userEvent.type(within(s).getByLabelText('Adaugă un URL prioritar'), 'https://urinal.example/pagina-noua')
    await userEvent.click(within(s).getByRole('button', { name: 'Adaugă' }))
    await waitFor(() => expect(within(section('URL-uri prioritare')).getByRole('list', { name: 'URL-uri prioritare' }).querySelectorAll('li')).toHaveLength(before + 1))
    const added = within(section('URL-uri prioritare')).getByText('https://urinal.example/pagina-noua').closest('li')!
    expect(within(added).getByText('Neinspectat încă')).toBeInTheDocument()
    await userEvent.click(within(added).getByRole('button', { name: 'Șterge https://urinal.example/pagina-noua' }))
    await waitFor(() => expect(within(section('URL-uri prioritare')).queryByText('https://urinal.example/pagina-noua')).toBeNull())
  })

  it('refuzul serverului la adăugare rămâne vizibil, cu mesajul lui', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, search: { ...b.search, addIndexUrl: async () => failed('URL-ul e deja în listă.') } }) })
    await open()
    const s = section('URL-uri prioritare')
    await userEvent.type(within(s).getByLabelText('Adaugă un URL prioritar'), 'https://urinal.example/a')
    await userEvent.click(within(s).getByRole('button', { name: 'Adaugă' }))
    expect(await within(s).findByRole('alert')).toHaveTextContent('URL-ul e deja în listă.')
  })

  it('clientul vede starea și lista, fără formular și fără ștergere', async () => {
    renderApp({ route: ROUTE, role: 'client_viewer', wrap: withStatus(STATUS) })
    await open()
    const s = section('URL-uri prioritare')
    expect(within(s).getAllByRole('listitem')).toHaveLength(2)
    expect(within(s).queryByLabelText('Adaugă un URL prioritar')).toBeNull()
    expect(within(s).queryByRole('button', { name: /Șterge/ })).toBeNull()
    expect(within(section('URL-uri inspectate')).getByRole('table')).toBeInTheDocument()
  })
})
