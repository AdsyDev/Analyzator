import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { pageReady, renderApp, where } from '../../test/renderApp'

const open = () => pageReady('Portofoliu')
const rows = () => within(screen.getByRole('table', { name: 'Portofoliu: indicatorii brandurilor' })).getAllByRole('row').slice(1)

describe('Portofoliu', () => {
  it('un rând pe fiecare brand permis, cu indicatorii din Overview', async () => {
    renderApp({ route: '/portfolio' })
    await open()
    await screen.findByRole('table', { name: 'Portofoliu: indicatorii brandurilor' })
    expect(rows().map((r) => within(r).getByRole('link').textContent)).toEqual(['Urinal', 'Minimartieni', 'Proenzi'])
    for (const h of ['Brand', 'Sesiuni', 'Key events', 'Mențiuni']) expect(screen.getByRole('columnheader', { name: new RegExp(`^${h}`) })).toBeInTheDocument()
  })

  it('cifra din portofoliu e cea de pe cardul din Overview al brandului', async () => {
    renderApp({ route: '/portfolio' })
    await open()
    await screen.findByRole('table', { name: 'Portofoliu: indicatorii brandurilor' })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
    const col = headers.findIndex((h) => h.startsWith('Sesiuni'))
    const cell = within(rows()[0]!).getAllByRole('cell')[col]!
    const value = cell.querySelector('span span')!.textContent!
    await userEvent.click(within(rows()[0]!).getByRole('link', { name: 'Urinal' }))
    await pageReady('Overview')
    expect(where()).toBe('/brands/brand-urinal/overview')
    expect((await screen.findByRole('article', { name: 'Sesiuni' })).textContent).toContain(value)
  })

  it('un brand ai cărui indicatori nu pot fi citiți rămâne în listă, cu motivul; celelalte își arată cifrele', async () => {
    renderApp({
      route: '/portfolio',
      wrap: (b) => ({ ...b, metrics: { ...b.metrics, metrics: async (c, k) => (c.brandId === 'brand-proenzi' ? Promise.reject(new Error('Timeout la citire.')) : b.metrics.metrics(c, k)) } }),
    })
    await open()
    await screen.findByRole('table', { name: 'Portofoliu: indicatorii brandurilor' })
    expect(rows()).toHaveLength(3)
    expect(within(rows()[2]!).getByRole('alert')).toHaveTextContent('Timeout la citire.')
    expect(within(rows()[2]!).getAllByText('Fără date').length).toBeGreaterThan(0)
    expect(within(rows()[0]!).queryByRole('alert')).toBeNull()
  })

  it('perioada aleasă se aplică tuturor brandurilor și rămâne în URL la deschiderea unui brand', async () => {
    const calls: string[] = []
    renderApp({ route: '/portfolio?period=7d', wrap: (b) => ({ ...b, metrics: { ...b.metrics, metrics: async (c, k) => (calls.push(`${c.brandId}:${c.period.preset}`), b.metrics.metrics(c, k)) } }) })
    await open()
    await screen.findByRole('table', { name: 'Portofoliu: indicatorii brandurilor' })
    expect(calls.sort()).toEqual(['brand-minimartieni:7d', 'brand-proenzi:7d', 'brand-urinal:7d'])
    await userEvent.click(within(rows()[1]!).getByRole('link', { name: 'Minimartieni' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-minimartieni/overview?period=7d'))
  })

  it('linkul „Portofoliu” apare în meniu doar cu cel puțin două branduri', async () => {
    renderApp({ route: '/brands/brand-urinal/overview' })
    await pageReady('Overview')
    expect(within(screen.getByRole('navigation', { name: 'Portofoliu' })).getByRole('link', { name: 'Portofoliu' })).toHaveAttribute('href', '/portfolio')
  })

  it('cu un singur brand, meniul nu are „Portofoliu”', async () => {
    renderApp({ route: '/brands/brand-urinal/overview', wrap: (b) => ({ ...b, brands: { ...b.brands, list: async () => { const r = await b.brands.list(); return r.kind === 'ready' ? { ...r, data: r.data.slice(0, 1) } : r } } }) })
    await pageReady('Overview')
    expect(screen.queryByRole('navigation', { name: 'Portofoliu' })).toBeNull()
  })
})
