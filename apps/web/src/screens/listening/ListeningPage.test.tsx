import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pageReady, renderApp, where } from '../../test/renderApp'

const URINAL = '/brands/brand-urinal/listening'

describe('Listening', () => {
  it('KPI-urile fără registru sunt „Indicator nedefinit", nu „Sursă neconectată" și nici zero', async () => {
    renderApp({ route: URINAL })
    await pageReady('Listening')
    for (const n of ['Mențiuni eligibile', 'Listening SoV', 'Pondere mențiuni negative']) {
      const card = await screen.findByRole('article', { name: n })
      expect(card).toHaveAttribute('data-status', 'not_connected')
      expect(await within(card).findByText('Indicator nedefinit')).toBeInTheDocument()
      expect(within(card).queryByText('Sursă neconectată')).toBeNull()
      expect(card).toHaveTextContent('Indicatorul vine din Planable, dar nu are încă definiție în registrul de metrici')
      expect(within(card).queryByText(/^\d/)).toBeNull()
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

  describe('filtrul „Limbă” (farmacovigilență, deciziile AA)', () => {
    type Wrap = NonNullable<Parameters<typeof renderApp>[0]['wrap']>
    const spy = (seen: Array<string | null | undefined>): Wrap => (b) => ({
      ...b,
      mentions: {
        ...b.mentions,
        list: async (c, q) => {
          seen.push(q.language)
          const r = await b.mentions.list(c, q)
          return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, other_language: q.language === 'all' ? 0 : 5 } } : r
        },
      },
    })
    const feed = () => screen.getByRole('heading', { level: 2, name: 'Mențiuni' }).closest('section')!

    it('agency_admin: implicit doar română, cu nota care spune cum vezi și celelalte limbi', async () => {
      const seen: Array<string | null | undefined> = []
      renderApp({ route: URINAL, wrap: spy(seen) })
      await pageReady('Listening')
      const note = await within(feed()).findByRole('note')
      expect(note).toHaveTextContent('5 mențiuni din perioadă sunt în altă limbă decât româna și nu sunt afișate.')
      expect(note).toHaveTextContent('Pentru verificarea de farmacovigilență, alege „Limbă: Toate limbile”.')
      expect(seen.every((l) => l === null)).toBe(true)
      expect(screen.getAllByRole('button', { name: 'Limbă' }).length).toBeGreaterThan(0)
    })

    it('agency_admin: „Toate limbile” din URL ajunge la provider, iar feed-ul spune ce nu se schimbă', async () => {
      const seen: Array<string | null | undefined> = []
      renderApp({ route: `${URINAL}?language=all`, wrap: spy(seen) })
      await pageReady('Listening')
      expect(await within(feed()).findByText(/Afișezi mențiunile în toate limbile, pentru verificarea de farmacovigilență/)).toBeInTheDocument()
      expect(feed()).toHaveTextContent('Distribuția sentimentului și indicatorii rămân doar pe limba română.')
      expect(feed()).not.toHaveTextContent('în altă limbă decât româna și nu')
      expect(seen).toContain('all')
      expect(screen.getAllByRole('button', { name: /Limbă:\s*Toate limbile/ }).length).toBeGreaterThan(0)
      expect(within(feed()).getAllByRole('button', { name: 'Marchează pentru farmacovigilență' }).length).toBeGreaterThan(0)
    })

    it('filtrul se alege din bară și schimbă cererea', async () => {
      const seen: Array<string | null | undefined> = []
      renderApp({ route: URINAL, wrap: spy(seen) })
      await pageReady('Listening')
      await within(feed()).findAllByTestId('mention')
      await userEvent.click(screen.getAllByRole('button', { name: 'Limbă' })[0]!)
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Toate limbile' }))
      await waitFor(() => expect(seen).toContain('all'))
      expect(where()).toContain('language=all')
    })

    it.each(['strategist', 'client_viewer'] as const)('%s: filtrul nu apare, iar ?language=all din URL e ignorat', async (role) => {
      const seen: Array<string | null | undefined> = []
      renderApp({ route: `${URINAL}?language=all`, role, wrap: spy(seen) })
      await pageReady('Listening')
      const note = await within(feed()).findByRole('note')
      expect(note).toHaveTextContent('5 mențiuni din perioadă sunt în altă limbă decât româna și nu sunt afișate.')
      expect(note).not.toHaveTextContent('Toate limbile')
      expect(seen.length).toBeGreaterThan(0)
      expect(seen.every((l) => l === null)).toBe(true)
      expect(screen.queryByRole('button', { name: 'Limbă' })).toBeNull()
      expect(screen.queryByRole('button', { name: /Limbă:/ })).toBeNull()
    })
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

    it('mențiunile în altă limbă (deciziile AA): feed-ul și distribuția spun câte au fost lăsate deoparte', async () => {
      const wrap: Wrap = (b) => ({
        ...b,
        mentions: {
          ...b.mentions,
          list: async (c, q) => { const r = await b.mentions.list(c, q); return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, other_language: 37 } } : r },
          sentiment: async (c) => { const r = await b.mentions.sentiment(c); return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, other_language: 37 } } : r },
        },
      })
      renderApp({ route: '/brands/brand-urinal/listening', wrap })
      await pageReady('Listening')
      const note = await within(feed()).findByRole('note')
      expect(note).toHaveTextContent('37 mențiuni din perioadă sunt în altă limbă decât româna și nu sunt afișate.')
      const dist = screen.getByRole('heading', { level: 2, name: 'Distribuția sentimentului' }).closest('section')!
      expect(await within(dist).findByText('37 mențiuni sunt în altă limbă decât româna și nu sunt incluse.')).toBeInTheDocument()
    })

    it('doar mențiuni în altă limbă: starea goală spune de ce', async () => {
      const wrap: Wrap = (b) => ({
        ...b,
        mentions: { ...b.mentions, list: async (c, q) => { const r = await b.mentions.list(c, q); return r.kind === 'ready' ? { kind: 'ready' as const, data: { ...r.data, items: [], total: 0, other_language: 1 } } : r } },
      })
      renderApp({ route: '/brands/brand-urinal/listening', wrap })
      await pageReady('Listening')
      expect(await within(feed()).findByText('Nicio mențiune de afișat')).toBeInTheDocument()
      expect(feed()).toHaveTextContent('1 mențiune din perioadă e în altă limbă decât româna și nu e afișată.')
    })

    it('fără astfel de mențiuni, nu apare nicio notă', async () => {
      renderApp({ route: '/brands/brand-urinal/listening' })
      await pageReady('Listening')
      await within(feed()).findAllByTestId('mention')
      expect(within(feed()).queryByRole('note')).toBeNull()
    })
  })
})
