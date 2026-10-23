import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ready, type PvLogEntry } from '../../contracts'
import { pageReady, renderApp, where } from '../../test/renderApp'

const ROUTE = '/brands/brand-urinal/pharmacovigilance'

const entry = (id: string, kind: PvLogEntry['item']['kind'], status: PvLogEntry['status'], excerpt: string): PvLogEntry => ({
  id,
  item: { kind, id: `${id}-item` },
  flagged_at: `2026-10-2${id.length}T08:00:00Z`,
  user: 'Ioana Popescu, AdSymphony',
  excerpt,
  link: null,
  notified: status !== 'pending',
  notified_to: status !== 'pending' ? ['pv@stada.example'] : [],
  status,
})
const LOG = [
  entry('p1', 'mention', 'pending', 'Mi-a fost greață după prima doză.'),
  entry('p22', 'mention', 'notified', 'Am avut amețeli două zile.'),
  entry('p333', 'ai_answer', 'acknowledged', 'Răspuns AI despre efecte adverse.'),
]
const withLog = (route: string) => renderApp({ route, wrap: (b) => ({ ...b, mentions: { ...b.mentions, pvLog: async () => ready(LOG) } }) })
const rows = async () => within(await screen.findByRole('table', { name: 'Jurnal de farmacovigilență' })).getAllByRole('row').slice(1)

describe('Listening → Farmacovigilență (E-2, varianta a)', () => {
  it('agency_admin: jurnalul PV, cu titlul și subtitlul paginii', async () => {
    withLog(ROUTE)
    await pageReady('Farmacovigilență')
    expect(screen.getByText(/Mențiunile și răspunsurile AI marcate pentru farmacovigilență, cu starea notificării/)).toBeInTheDocument()
    expect(await rows()).toHaveLength(3)
  })

  it('filtrul Status din URL păstrează doar marcajele cu acea stare', async () => {
    withLog(`${ROUTE}?status=pending`)
    await pageReady('Farmacovigilență')
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toHaveTextContent('Mi-a fost greață după prima doză.')
    expect(within(screen.getByRole('group', { name: 'Filtre active' })).getByText('Status: În așteptare')).toBeInTheDocument()
  })

  it('filtrul Tip separă mențiunile de răspunsurile AI', async () => {
    withLog(`${ROUTE}?item=ai_answer`)
    await pageReady('Farmacovigilență')
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toHaveTextContent('Răspuns AI')
  })

  it('filtre fără rezultat: mesaj care spune câte marcaje are jurnalul, nu „niciun marcaj”', async () => {
    withLog(`${ROUTE}?status=pending&item=ai_answer`)
    await pageReady('Farmacovigilență')
    expect(await screen.findByText('Niciun marcaj pentru filtrele alese')).toBeInTheDocument()
    expect(screen.getByText(/Jurnalul are 3 marcaje/)).toBeInTheDocument()
  })

  it('valori necunoscute în URL sunt ignorate', async () => {
    withLog(`${ROUTE}?status=sters&item=tot`)
    await pageReady('Farmacovigilență')
    expect(await rows()).toHaveLength(3)
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
  })

  it('perioada din URL ajunge la jurnal; statusul și tipul nu cer din nou jurnalul', async () => {
    const periods: string[] = []
    renderApp({ route: `${ROUTE}?period=7d&status=notified`, wrap: (b) => ({ ...b, mentions: { ...b.mentions, pvLog: async (ctx) => (periods.push(`${ctx.period.from}…${ctx.period.to}`), ready(LOG)) } }) })
    await pageReady('Farmacovigilență')
    expect(await rows()).toHaveLength(1)
    expect(periods).toHaveLength(1)
    const [from, to] = periods[0]!.split('…') as [string, string]
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6)
  })

  it.each(['strategist', 'account', 'client_viewer'] as const)('%s e redirecționat la Listening, fără cerere spre jurnal', async (role) => {
    const pvLog = vi.fn()
    renderApp({ route: ROUTE, role, wrap: (b) => ({ ...b, mentions: { ...b.mentions, pvLog } }) })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/listening'))
    await pageReady('Listening')
    expect(screen.queryByRole('heading', { name: 'Jurnal de farmacovigilență' })).toBeNull()
    expect(pvLog).not.toHaveBeenCalled()
  })
})
