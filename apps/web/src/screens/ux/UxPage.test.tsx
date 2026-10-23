import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pageReady, renderApp, where } from '../../test/renderApp'

const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const ROUTE = '/brands/brand-urinal/ux'
const open = () => pageReady('User experience')

describe('User experience: pagina (E-1, varianta a)', () => {
  it('titlul, subtitlul și secțiunea Comportament; apare în meniu după Trafic', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(screen.getByText(/Cum folosesc vizitatorii site-ul, din Microsoft Clarity/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Comportament' })).toBeInTheDocument()
    const links = within(screen.getByRole('navigation', { name: 'Module' })).getAllByRole('link').map((a) => a.textContent)
    expect(links.indexOf('User experience')).toBe(links.indexOf('Trafic și conversii') + 1)
    expect(document.title).toBe('User experience · Urinal · Analyzator')
  })

  it('o singură cerere Clarity; niciuna pentru canale, AI referrals sau tracking', async () => {
    const calls = { ch: 0, ai: 0, cl: 0, tq: 0 }
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, traffic: { channels: async (c, d) => (calls.ch++, b.traffic.channels(c, d)), aiReferrals: async (c) => (calls.ai++, b.traffic.aiReferrals(c)), clarityDevices: async (c) => (calls.cl++, b.traffic.clarityDevices(c)), trackingQuality: async (c) => (calls.tq++, b.traffic.trackingQuality(c)) } }) })
    await open()
    await within(section('Comportament')).findByRole('table')
    expect(calls).toEqual({ ch: 0, ai: 0, cl: 1, tq: 0 })
  })

  it('un brand nepermis nu declanșează nicio cerere Clarity', async () => {
    const { providers } = renderApp({ route: '/brands/brand-strain/ux' })
    const spy = vi.spyOn(providers.traffic, 'clarityDevices')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('User experience: comportament (Clarity), mutat din Trafic', () => {
  it('Urinal: banner de sincronizare cu motivul, „Reconectează în Surse" pentru agency_admin', async () => {
    renderApp({ route: ROUTE })
    await open()
    const alert = await within(section('Comportament')).findByRole('alert')
    expect(alert).toHaveTextContent('Sincronizarea Clarity are probleme: Tokenul API a expirat.')
    expect(alert).toHaveTextContent(/Afișăm ultimele date importate/)
    await userEvent.click(within(alert).getByRole('button', { name: 'Reconectează în Surse' }))
    await waitFor(() => expect(where()).toBe('/admin/clients/brand-urinal?source=clarity'))
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
    renderApp({ route: '/brands/brand-proenzi/ux' })
    await open()
    expect(await within(section('Comportament')).findByText(/Sursa Microsoft Clarity nu este conectată pentru acest brand/)).toBeInTheDocument()
    expect(within(section('Comportament')).queryByRole('alert')).toBeNull()
  })

  it('Minimartieni: Clarity sănătos, fără banner', async () => {
    renderApp({ route: '/brands/brand-minimartieni/ux' })
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
