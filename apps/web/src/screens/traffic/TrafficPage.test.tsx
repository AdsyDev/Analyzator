import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failed } from '../../contracts'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp, where } from '../../test/renderApp'

const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const ROUTE = '/brands/brand-urinal/traffic'
const open = () => pageReady('Trafic și conversii')

describe('Trafic și conversii: structura din spec cap. 16', () => {
  it('KPI, canale, AI referrals, comportament și tracking quality', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(5)
    for (const h of ['Canale', 'AI referrals', 'Comportament', 'Tracking quality']) expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    expect(screen.getByText(/Ce se întâmplă după click/)).toBeInTheDocument()
  })

  it('stările KPI din registru; „Engagement rate" nu e în registru și nu se calculează în UI', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(screen.getByRole('article', { name: 'Sesiuni' })).toHaveAttribute('data-status', 'ok')
    expect(screen.getByRole('article', { name: 'Sesiuni cu implicare' })).toHaveAttribute('data-status', 'partial')
    expect(screen.getByRole('article', { name: 'Key events' })).toHaveAttribute('data-status', 'stale')
    const users = screen.getByRole('article', { name: 'Utilizatori activi' })
    expect(users).toHaveAttribute('data-status', 'not_connected')
    const rate = screen.getByRole('article', { name: 'Engagement rate' })
    expect(rate).toHaveAttribute('data-status', 'not_connected')
    await userEvent.click(within(rate).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(within(rate).getByRole('tooltip')).toHaveTextContent('Definiția acestui indicator nu este încă în registrul de metrici.')
  })
})

describe('Trafic: canale', () => {
  it('șapte canale cu sesiuni, pondere, variație, engagement și key events', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Canale')
    const rows = within(await within(s).findByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(7)
    const ai = rows.find((r) => within(r).queryByText('AI referrals'))!
    expect(within(ai).getByText(/\+31,2/)).toBeInTheDocument()
    expect(within(ai).getByText('creștere', { exact: false })).toBeInTheDocument()
    const direct = rows.find((r) => within(r).queryByText('Direct'))!
    expect(within(direct).getByText('scădere', { exact: false })).toBeInTheDocument()
  })

  it('se sortează după sesiuni', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Canale')
    await userEvent.click(within(within(await within(s).findByRole('table')).getByRole('columnheader', { name: /Sesiuni/ })).getByRole('button'))
    const vals = within(within(s).getByRole('table')).getAllByRole('row').slice(1).map((r) => Number(within(r).getAllByRole('cell')[1]!.textContent!.replace(/\./g, '')))
    expect(vals).toEqual([...vals].sort((a, b) => a - b))
  })

  it('filtrul Device din URL: etichetă în secțiune, chip activ, sesiuni mai mici; KPI-urile rămân pe toate device-urile', async () => {
    renderApp({ route: ROUTE })
    await open()
    const total = (rows: HTMLElement[]) => rows.reduce((a, r) => a + Number(within(r).getAllByRole('cell')[1]!.textContent!.replace(/\./g, '')), 0)
    const all = total(within(await within(section('Canale')).findByRole('table')).getAllByRole('row').slice(1))
    await userEvent.click(screen.getByRole('button', { name: 'Device' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Mobil' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/traffic?device=mobile'))
    expect(await screen.findByText('Filtrat pe device: Mobil. Indicatorii de sus rămân pe toate device-urile.')).toBeInTheDocument()
    await waitFor(() => expect(total(within(within(section('Canale')).getByRole('table')).getAllByRole('row').slice(1))).toBeLessThan(all))
    expect(within(screen.getByRole('group', { name: 'Filtre active' })).getByText('Device: Mobil')).toBeInTheDocument()
  })

  it('un device necunoscut din URL e ignorat', async () => {
    renderApp({ route: `${ROUTE}?device=smart-tv` })
    await open()
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
  })
})

describe('Trafic: AI referrals', () => {
  it('surse cu sesiuni, key events și rată; regulile versionate și nota despre Direct', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('AI referrals')
    const rows = within(await within(s).findByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com'])
    expect(within(s).getByText(/Reguli de clasificare/)).toHaveTextContent(/v3.*în vigoare din 1 sept\.?\s2026/)
    expect(within(s).getByText(/Traficul fără referrer poate ajunge în Direct/)).toBeInTheDocument()
  })
})

describe('Trafic: comportament (Clarity)', () => {
  it('Urinal: banner de sincronizare cu motivul, „Reconectează în Surse" pentru agency_admin', async () => {
    renderApp({ route: ROUTE })
    await open()
    const alert = await within(section('Comportament')).findByRole('alert')
    expect(alert).toHaveTextContent('Sincronizarea Clarity are probleme: Tokenul API a expirat.')
    expect(alert).toHaveTextContent(/Afișăm ultimele date importate/)
    await userEvent.click(within(alert).getByRole('button', { name: 'Reconectează în Surse' }))
    await waitFor(() => expect(where()).toBe('/admin/sources'))
  })

  it('strategistul vede bannerul, dar nu acțiunea spre Surse', async () => {
    renderApp({ route: ROUTE, role: 'strategist' })
    await open()
    const alert = await within(section('Comportament')).findByRole('alert')
    expect(within(alert).queryByRole('button')).toBeNull()
  })

  it('tabelul: patru metrici din registru, coloanele Toate + device, definiții provizorii marcate, stare Învechit', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Comportament')
    const table = await within(s).findByRole('table')
    for (const h of ['Indicator', 'Toate', 'Desktop', 'Mobil', 'Tabletă', 'Stare']) expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      expect.stringContaining('Sesiuni cu rage clicks'), expect.stringContaining('Sesiuni cu dead clicks'), expect.stringContaining('Sesiuni cu quick backs'), expect.stringContaining('Scroll depth mediu'),
    ])
    for (const r of rows) {
      expect(within(r).getByText('Provizoriu')).toBeInTheDocument() // definiții draft în registru
      expect(within(r).getByText('Învechit')).toBeInTheDocument()
    }
    expect(within(s).getAllByText(/Date până la/).length).toBeGreaterThan(0)
  })

  it('valorile pe device nu sunt zero când lipsesc: Proenzi nu are Clarity conectat', async () => {
    renderApp({ route: '/brands/brand-proenzi/traffic' })
    await open()
    expect(await within(section('Comportament')).findByText(/Sursa Microsoft Clarity nu este conectată pentru acest brand/)).toBeInTheDocument()
    expect(within(section('Comportament')).queryByRole('alert')).toBeNull()
  })

  it('Minimartieni: Clarity sănătos, fără banner', async () => {
    renderApp({ route: '/brands/brand-minimartieni/traffic' })
    await open()
    await within(section('Comportament')).findByRole('table')
    expect(within(section('Comportament')).queryByRole('alert')).toBeNull()
  })

  it('tooltipul fiecărui indicator arată definiția din registru', async () => {
    renderApp({ route: ROUTE })
    await open()
    const th = within(await within(section('Comportament')).findByRole('table')).getAllByRole('rowheader')[0]!
    await userEvent.click(within(th).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(within(th).getByRole('tooltip')).toHaveTextContent('Sesiunile Clarity cu rage clicks; suma zilelor.')
  })
})

describe('Trafic: tracking quality', () => {
  it('verificări cu stare în text (Problemă, Avertisment, În regulă) și momentul verificării', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Tracking quality')
    const items = await within(s).findAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual(['problem', 'ok', 'warning', 'ok'])
    expect(within(items[0]!).getByText('Problemă')).toBeInTheDocument()
    expect(within(items[2]!).getByText('Avertisment')).toBeInTheDocument()
    expect(within(s).getByText(/Verificat la/)).toBeInTheDocument()
    expect(within(s).getByText(/Cifrele de mai sus sunt la fel de bune ca măsurarea/)).toBeInTheDocument()
  })

  it('Proenzi: key events nemapate (problemă) și sampling necunoscut', async () => {
    renderApp({ route: '/brands/brand-proenzi/traffic' })
    await open()
    const s = section('Tracking quality')
    expect(await within(s).findByText('Key events nemapate')).toBeInTheDocument()
    expect(within(s).getByText('Necunoscut')).toBeInTheDocument()
    expect(within(s).getByText(/nu produce retroactiv evenimente/)).toBeInTheDocument()
  })
})

describe('Trafic: izolarea secțiunilor și providerul real', () => {
  it('canale căzute: mesaj cu „Reîncearcă", restul rămân', async () => {
    let n = 0
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, traffic: { ...b.traffic, channels: async (c, d) => (++n === 1 ? failed('GA4 nu răspunde.') : b.traffic.channels(c, d)) } }) })
    await screen.findByRole('heading', { level: 1, name: 'Trafic și conversii' })
    expect(await screen.findByText('GA4 nu răspunde.')).toBeInTheDocument()
    expect(await within(section('AI referrals')).findByRole('table')).toBeInTheDocument()
    await userEvent.click(within(section('Canale')).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(section('Canale')).findByRole('table')).toBeInTheDocument()
  })

  it('cu providerul real: fiecare secțiune explică lipsa sursei, fără date inventate', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, traffic: createSupabaseProviders().traffic }) })
    await open()
    await waitFor(() => expect(screen.getAllByText(/nu sunt încă disponibile pentru acest brand/).length).toBeGreaterThanOrEqual(3))
    expect(screen.queryByText(/supabase|stack/i)).toBeNull()
  })

  it('o singură cerere pe secțiune', async () => {
    const calls = { ch: 0, ai: 0, cl: 0, tq: 0 }
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, traffic: { channels: async (c, d) => (calls.ch++, b.traffic.channels(c, d)), aiReferrals: async (c) => (calls.ai++, b.traffic.aiReferrals(c)), clarityDevices: async (c) => (calls.cl++, b.traffic.clarityDevices(c)), trackingQuality: async (c) => (calls.tq++, b.traffic.trackingQuality(c)) } }) })
    await open()
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toEqual({ ch: 1, ai: 1, cl: 1, tq: 1 })
  })

  it('un brand nepermis nu declanșează nicio cerere de trafic', async () => {
    const { providers } = renderApp({ route: '/brands/brand-strain/traffic' })
    const spy = vi.spyOn(providers.traffic, 'channels')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})
