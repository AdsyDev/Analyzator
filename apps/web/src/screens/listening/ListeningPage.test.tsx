import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pageReady, renderApp, where } from '../../test/renderApp'

const URINAL = '/brands/brand-urinal/listening'

describe('Listening', () => {
  it('KPI-urile fără registru sunt „Sursă neconectată", nu zero', async () => {
    renderApp({ route: URINAL })
    await pageReady('Listening')
    for (const n of ['Mențiuni eligibile', 'Listening SoV', 'Pondere mențiuni negative']) {
      expect(await screen.findByRole('article', { name: n })).toHaveAttribute('data-status', 'not_connected')
    }
  })

  it('distribuția numără doar mențiunile revizuite și spune câte așteaptă', async () => {
    renderApp({ route: URINAL })
    await pageReady('Listening')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Distribuția sentimentului' })).closest('section')!
    expect(await within(s).findByText(/2 mențiuni așteaptă revizuirea umană/)).toBeInTheDocument()
    expect(within(s).getByRole('img', { name: /Pozitiv .*Neutru .*Negativ/ })).toBeInTheDocument()
  })

  it('feed: sentiment „Nerevizuit" vs revizuit de cineva; filtrul din URL îl restrânge', async () => {
    renderApp({ route: `${URINAL}?sentiment=unreviewed` })
    await pageReady('Listening')
    const items = await screen.findAllByTestId('mention')
    expect(items).toHaveLength(2)
    for (const i of items) {
      expect(within(i).getByText('Nerevizuit')).toBeInTheDocument()
      expect(within(i).getByText('Fără revizuire umană încă')).toBeInTheDocument()
    }
  })

  it('marcarea PV arată dialogul, apoi starea „marcat" persistă după reîncărcare', async () => {
    renderApp({ route: URINAL })
    await pageReady('Listening')
    const first = (await screen.findAllByTestId('mention'))[0]!
    expect(first).toHaveAttribute('data-flagged', 'false')
    await userEvent.click(within(first).getByRole('button', { name: /farmacovigilență/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /Confirm|Marchează/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getAllByTestId('mention')[0]).toHaveAttribute('data-flagged', 'true'))
  })

  it('jurnalul PV s-a mutat în submeniul Farmacovigilență (E-2): agency_admin are linkul, fără jurnal pe pagină', async () => {
    renderApp({ route: `${URINAL}?period=7d` })
    await pageReady('Listening')
    await screen.findAllByTestId('mention')
    expect(screen.queryByRole('heading', { level: 2, name: 'Jurnal de farmacovigilență' })).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Listening → Farmacovigilență' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/pharmacovigilance?period=7d'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Jurnal de farmacovigilență' })).toBeInTheDocument()
  })

  it.each(['strategist', 'client_viewer'] as const)('jurnalul PV nu apare și nu se cere pentru %s', async (role) => {
    const pvLog = vi.fn()
    renderApp({ route: URINAL, role, wrap: (b) => ({ ...b, mentions: { ...b.mentions, pvLog } }) })
    await pageReady('Listening')
    await screen.findAllByTestId('mention')
    expect(screen.queryByRole('heading', { name: 'Jurnal de farmacovigilență' })).toBeNull()
    expect(pvLog).not.toHaveBeenCalled()
  })

  it('cont propriu (D-22): eticheta în feed, filtrul „Autor” din URL ajunge la provider, nota din distribuție', async () => {
    const seen: Array<string | null> = []
    renderApp({
      route: `${URINAL}?author=owned`,
      wrap: (b) => ({
        ...b,
        mentions: {
          ...b.mentions,
          list: async (ctx, q) => {
            seen.push(q.author)
            const r = await b.mentions.list(ctx, { ...q, author: null })
            return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, items: r.data.items.slice(0, 1).map((m) => ({ ...m, owned_account: true })), total: 1 } } : r
          },
          sentiment: async (ctx) => {
            const r = await b.mentions.sentiment(ctx)
            return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, owned_excluded: 2 } } : r
          },
        },
      }),
    })
    await pageReady('Listening')
    const feed = (await screen.findByRole('heading', { level: 2, name: 'Mențiuni' })).closest('section')!
    expect(await within(feed).findByText('Cont propriu')).toBeInTheDocument()
    expect(seen).toContain('owned')
    const dist = (await screen.findByRole('heading', { level: 2, name: 'Distribuția sentimentului' })).closest('section')!
    expect(await within(dist).findByText(/2 postări din conturile proprii ale brandului nu sunt incluse/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Autor:\s*Cont propriu/ }).length).toBeGreaterThan(0)
  })

  describe('mențiuni fără conținut (web, din Planable)', () => {
    type Wrap = NonNullable<Parameters<typeof renderApp>[0]['wrap']>
    const withCount = (n: number, empty = false): Wrap => (b) => ({
      ...b,
      mentions: {
        ...b.mentions,
        list: async (c, q) => { const r = await b.mentions.list(c, q); return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, ...(empty ? { items: [], total: 0 } : {}), without_content: n } } : r },
        sentiment: async (c) => { const r = await b.mentions.sentiment(c); return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, without_content: n } } : r },
      },
    })
    const feed = () => screen.getByRole('heading', { level: 2, name: 'Mențiuni' }).closest('section')!

    it('feed-ul spune câte au venit fără text și link și nu arată carduri goale pentru ele', async () => {
      renderApp({ route: '/brands/brand-urinal/listening', wrap: withCount(1068) })
      await pageReady('Listening')
      const note = await within(feed()).findByRole('note')
      expect(note.textContent?.replace(/\s/g, ' ')).toContain('1.068 mențiuni din perioadă au venit de la sursă fără text și fără link')
      expect(note).toHaveTextContent('Sunt numărate la „Mențiuni”, dar nu pot fi afișate sau revizuite.')
      const cards = within(feed()).getAllByTestId('mention')
      expect(cards.length).toBeGreaterThan(0)
      expect(cards.every((c) => (c.textContent ?? '').trim().length > 0)).toBe(true)
    })

    it('fără nicio mențiune cu conținut: starea goală explică de ce, în loc de „schimbă filtrele”', async () => {
      renderApp({ route: '/brands/brand-urinal/listening', wrap: withCount(1, true) })
      await pageReady('Listening')
      expect(await within(feed()).findByText('Nicio mențiune de afișat')).toBeInTheDocument()
      expect(feed()).toHaveTextContent('1 mențiune din perioadă a venit de la sursă fără text și fără link')
      expect(within(feed()).queryByText('Schimbă sentimentul, sursa sau perioada.')).toBeNull()
    })

    it('distribuția le menționează separat și nu le pune la „așteaptă revizuirea”', async () => {
      renderApp({ route: '/brands/brand-urinal/listening', wrap: withCount(12) })
      await pageReady('Listening')
      const dist = screen.getByRole('heading', { level: 2, name: 'Distribuția sentimentului' }).closest('section')!
      expect(await within(dist).findByText(/12 mențiuni au venit de la sursă fără text și fără link și nu pot fi revizuite\./)).toBeInTheDocument()
      expect(dist).toHaveTextContent(/2 mențiuni așteaptă revizuirea umană/)
    })

    it('fără astfel de mențiuni, nu apare nicio notă', async () => {
      renderApp({ route: '/brands/brand-urinal/listening' })
      await pageReady('Listening')
      await within(feed()).findAllByTestId('mention')
      expect(within(feed()).queryByRole('note')).toBeNull()
    })
  })
})
