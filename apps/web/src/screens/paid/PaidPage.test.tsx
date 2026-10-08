import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failed } from '../../contracts'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp, where } from '../../test/renderApp'

const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const MINI = '/brands/brand-minimartieni/paid'
const open = () => pageReady('Paid Media')
const tableRows = () => within(within(section('Performanță pe zi')).getByRole('table')).getAllByRole('row').slice(1)

describe('Paid Media fără import', () => {
  it('„Sursă neconectată", motivul din design, „Importă CSV" pentru agency_admin; nicio cifră', async () => {
    renderApp({ route: '/brands/brand-urinal/paid' })
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText(/Google Ads și Meta Ads nu sunt conectate pentru Urinal/)).toBeInTheDocument()
    expect(screen.getByText(/importă un export CSV/)).toBeInTheDocument()
    expect(screen.queryByTestId('paid-kpis')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Importă CSV' }))
    await waitFor(() => expect(where()).toBe('/admin/sources'))
  })

  it.each(['strategist', 'account', 'client_viewer'] as const)('%s nu primește o acțiune care nu funcționează', async (role) => {
    renderApp({ route: '/brands/brand-urinal/paid', role })
    await screen.findByRole('heading', { name: 'Sursă neconectată' })
    expect(screen.queryByRole('button', { name: 'Importă CSV' })).toBeNull()
  })

  it('cu providerul real (neconectat) pagina arată aceeași stare', async () => {
    renderApp({ route: MINI, wrap: (b) => ({ ...b, paid: createSupabaseProviders().paid }) })
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText(/Google Ads și Meta Ads nu sunt conectate pentru Minimartieni/)).toBeInTheDocument()
  })

  it('eroare la poartă: mesaj cu „Reîncearcă", nu „Sursă neconectată"', async () => {
    let n = 0
    renderApp({ route: MINI, wrap: (b) => ({ ...b, paid: { ...b.paid, summary: async (c, f) => (++n === 1 ? failed('Timeout.') : b.paid.summary(c, f)) } }) })
    expect(await screen.findByText('Timeout.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sursă neconectată' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(await screen.findByTestId('paid-kpis')).toBeInTheDocument()
  })
})

describe('Paid Media cu import', () => {
  it('bara de context: date până la, import, monedă și fus orar', async () => {
    renderApp({ route: MINI })
    await open()
    const bar = await screen.findByText(/Fus orar al exportului/)
    expect(bar.closest('p')).toHaveTextContent('RON')
    expect(bar.closest('p')).toHaveTextContent('Europe/Bucharest')
    expect(bar.closest('p')).toHaveTextContent(/Date până la/)
  })

  it('șapte KPI cu definiție în tooltip, bani cu moneda lângă valoare', async () => {
    renderApp({ route: MINI })
    await open()
    const grid = await screen.findByTestId('paid-kpis')
    expect(within(grid).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Spend', 'Impressions', 'Clicks', 'CTR', 'CPC', 'Conversii', 'CPA'])
    expect(within(within(grid).getByRole('article', { name: 'Spend' })).getByText(/^[\d.]+\sRON$/)).toBeInTheDocument()
    expect(within(within(grid).getByRole('article', { name: 'CPC' })).getByText(/^\d+,\d{2}\sRON$/)).toBeInTheDocument()
    await userEvent.click(within(within(grid).getByRole('article', { name: 'Clicks' })).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/tipul declarat de sursă \(aici: link clicks\)/)
  })

  it('CTR: variația în puncte procentuale; fiecare card arată comparația', async () => {
    renderApp({ route: MINI })
    await open()
    const ctr = within(await screen.findByTestId('paid-kpis')).getByRole('article', { name: 'CTR' })
    expect(within(ctr).getByText(/p\.p\./)).toBeInTheDocument()
    expect(within(ctr).getByText(/față de .* - .*\d{4}/)).toBeInTheDocument()
  })

  it('buget și pacing: două bare cu valori ARIA, planul și nota; fără verdict automat', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await waitForSection('Buget și pacing')
    const bars = await within(s).findAllByRole('progressbar')
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(['Spend față de buget', 'Zile trecute din plan'])
    for (const b of bars) expect(Number(b.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    expect(within(s).getByText(/din 24\.000\sRON/)).toBeInTheDocument()
    expect(within(s).getByText(/Plan lunar cu distribuție liniară/)).toBeInTheDocument()
    expect(within(s).getByText(/Progresul liniar e un reper, nu un verdict/)).toBeInTheDocument()
    expect(s.textContent).not.toMatch(/depășit|în urmă|peste ritm|sub ritm/i)
  })

  it('evoluție: spend și conversii în grafice separate, cu gol pentru zilele neimportate', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await waitForSection('Evoluție')
    const figs = await within(s).findAllByRole('figure')
    expect(figs.map((f) => f.getAttribute('aria-label'))).toEqual(['Spend (RON)', 'Conversii'])
    expect(within(s).getAllByTestId('chart-gap').length).toBeGreaterThan(0)
  })

  it('tabelul pe zi, platformă, cont, campanie; N/A pentru awareness, nu zero; moneda în antet', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await waitForSection('Performanță pe zi')
    const table = await within(s).findByRole('table')
    for (const h of ['Data', 'Platformă', 'Cont', 'Campanie', 'Obiectiv', 'Spend (RON)', 'Impressions', 'Clicks', 'CTR', 'CPC', 'Conversii', 'CPA', 'Atribuire']) expect(within(table).getByRole('columnheader', { name: new RegExp(`^${h.replace(/[()]/g, '\\$&')}`) })).toBeInTheDocument()
    expect(tableRows()).toHaveLength(12)
    await userEvent.click(within(within(table).getByRole('columnheader', { name: /Obiectiv/ })).getByRole('button'))
    const aw = tableRows().find((r) => within(r).queryByText('Awareness'))!
    expect(within(aw).getAllByText('N/A')).toHaveLength(2)
    expect(within(aw).getByText(/vizualizare 1 zi/)).toBeInTheDocument()
  })

  it('nu există galerie de creatives', async () => {
    renderApp({ route: MINI })
    await open()
    await screen.findByTestId('paid-kpis')
    expect(screen.queryByText(/creatives/i)).toBeNull()
    expect(screen.queryAllByRole('img').filter((i) => i.tagName === 'IMG')).toHaveLength(0)
  })

  it('filtrul de platformă din meniu: URL, chip și doar rândurile platformei', async () => {
    renderApp({ route: MINI })
    await open()
    await screen.findByTestId('paid-kpis')
    await userEvent.click(within(screen.getByRole('region', { name: 'Filtre' })).getByRole('button', { name: 'Platformă' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Google Ads' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-minimartieni/paid?platform=google_ads'))
    await waitFor(() => expect(tableRows().every((r) => within(r).queryByText('Google Ads') !== null)).toBe(true))
    expect(within(await screen.findByRole('group', { name: 'Filtre active' })).getByText('Platformă: Google Ads')).toBeInTheDocument()
  })

  it('o platformă necunoscută din URL e ignorată', async () => {
    renderApp({ route: `${MINI}?platform=tiktok` })
    await open()
    await screen.findByTestId('paid-kpis')
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
  })

  it('tabelul căzut: mesaj cu „Reîncearcă", iar KPI, buget și evoluție rămân', async () => {
    let n = 0
    renderApp({ route: MINI, wrap: (b) => ({ ...b, paid: { ...b.paid, rows: async (c, f) => (++n === 1 ? failed('Export indisponibil.') : b.paid.rows(c, f)) } }) })
    await screen.findByRole('heading', { level: 1, name: 'Paid Media' })
    expect(await screen.findByText('Export indisponibil.')).toBeInTheDocument()
    expect(screen.getByTestId('paid-kpis')).toBeInTheDocument()
    await userEvent.click(within(section('Performanță pe zi')).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(section('Performanță pe zi')).findByRole('table')).toBeInTheDocument()
  })

  it('o singură cerere pe secțiune; un brand nepermis nu face nicio cerere', async () => {
    const calls = { s: 0, b: 0, se: 0, r: 0 }
    renderApp({ route: MINI, wrap: (b) => ({ ...b, paid: { summary: async (c, f) => (calls.s++, b.paid.summary(c, f)), budget: async (c) => (calls.b++, b.paid.budget(c)), series: async (c, f) => (calls.se++, b.paid.series(c, f)), rows: async (c, f) => (calls.r++, b.paid.rows(c, f)) } }) })
    await open()
    await screen.findByTestId('paid-kpis')
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toEqual({ s: 1, b: 1, se: 1, r: 1 })
    const { providers } = renderApp({ route: '/brands/brand-strain/paid' })
    const spy = vi.spyOn(providers.paid, 'summary')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})

async function waitForSection(name: string) {
  await screen.findByRole('heading', { level: 2, name })
  return section(name)
}
