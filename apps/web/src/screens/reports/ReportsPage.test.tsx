import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pageReady, renderApp, where } from '../../test/renderApp'
import { REPORT_GROUPS, REPORT_KEYS } from './slots'

const ROUTE = '/brands/brand-urinal/reports'
const open = () => pageReady('Rapoarte')
const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!

describe('Rapoarte', () => {
  it('antetul spune brandul, perioada, comparația și momentul generării', async () => {
    renderApp({ route: ROUTE })
    await open()
    const head = screen.getByRole('region', { name: 'Antetul raportului' })
    expect(within(head).getByText(/^Urinal/)).toBeInTheDocument()
    for (const label of ['Brand', 'Perioadă', 'Comparată cu', 'Generat la']) expect(within(head).getByText(label)).toBeInTheDocument()
    expect(within(head).getByText(/perioada anterioară/)).toBeInTheDocument()
  })

  it('un tabel pe grup, cu fiecare indicator din raport; valoarea lipsă e explicată, nu zero', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Indicatori')
    await within(s).findAllByRole('table')
    expect(within(s).getAllByRole('table').map((t) => t.querySelector('caption')?.textContent)).toEqual(REPORT_GROUPS.map((g) => g.title))
    expect(within(s).getAllByRole('row').filter((r) => r.hasAttribute('data-status'))).toHaveLength(REPORT_KEYS.length)
    // Urinal nu are Paid conectat în fixtures: rândurile rămân, cu starea lor.
    const paid = within(s).getByRole('table', { name: 'Paid Media' })
    for (const row of within(paid).getAllByRole('row').slice(1)) {
      expect(within(row).getByText('Fără date')).toBeInTheDocument()
      expect(row).toHaveAttribute('data-status', 'not_connected')
      expect(row.textContent).toMatch(/Sursă neconectată/)
    }
  })

  it('aceeași valoare ca pe cardul din Overview', async () => {
    renderApp({ route: ROUTE })
    await open()
    const row = (await within(section('Indicatori')).findAllByRole('row')).find((r) => within(r).queryByRole('rowheader', { name: 'Clicks (Search Console)' }))!
    const value = within(row).getAllByRole('cell')[0]!.textContent!
    expect(value).toMatch(/\d/)
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await pageReady('Imaginea completă a brandului')
    const card = await screen.findByRole('article', { name: 'Clicks (Search Console)' })
    expect(card.textContent).toContain(value)
  })

  it('doar analizele publicate, cu recomandările și acțiunile lor', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Analize publicate')
    await waitFor(() => expect(within(s).queryByRole('status')).toBeNull())
    const titles = within(s).queryAllByRole('heading', { level: 3 })
    expect(titles.length).toBeGreaterThan(0)
    expect(s.textContent).not.toMatch(/Ciornă|În review/)
  })

  it('clientul primește același raport, fără analize nepublicate', async () => {
    renderApp({ route: ROUTE, role: 'client_viewer' })
    await open()
    expect(await within(section('Indicatori')).findAllByRole('table')).toHaveLength(REPORT_GROUPS.length)
    expect(screen.getByRole('button', { name: 'Tipărește sau salvează ca PDF' })).toBeInTheDocument()
  })

  it('„Tipărește sau salvează ca PDF” deschide tipărirea browserului; exportul scrie indicatorii în CSV', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const blobs: Blob[] = []
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), 'blob:test')), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp({ route: ROUTE })
    await open()
    await within(section('Indicatori')).findAllByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Tipărește sau salvează ca PDF' }))
    expect(print).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Exportă indicatorii (CSV)' }))
    const lines = (await blobs[0]!.text()).trim().split('\r\n')
    expect(lines[0]).toBe('Grup;Indicator;Cheie;Valoare;Unitate;Monedă;Valoare de comparație;Variație absolută;Variație relativă (%);Stare')
    expect(lines).toHaveLength(REPORT_KEYS.length + 1)
    // Fără sursă: valoarea, comparația și variațiile sunt celule goale, nu zero.
    expect(lines.find((l) => l.includes(';google_ads_spend;'))).toMatch(/;google_ads_spend;;[a-z]*;;;;;not_connected$/)
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('perioada din URL se păstrează și intră în raport', async () => {
    renderApp({ route: `${ROUTE}?period=7d` })
    await open()
    expect(where()).toBe(`${ROUTE}?period=7d`)
    expect(within(screen.getByRole('region', { name: 'Filtre' })).getByRole('button', { name: 'Perioadă' })).toHaveTextContent(/7 zile/)
  })
})
