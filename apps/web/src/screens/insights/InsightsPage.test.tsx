import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp } from '../../test/renderApp'

const URINAL = '/brands/brand-urinal/insights'
const cards = async () => within((await screen.findByRole('heading', { level: 2, name: 'Analize' })).closest('section')!).findAllByRole('article')

describe('Analize și acțiuni — vederea agenției', () => {
  it('arată toate cele patru statusuri, cu badge', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const list = await cards()
    expect(list.map((c) => c.getAttribute('data-status')).sort()).toEqual(['draft', 'in_review', 'published', 'superseded'])
    expect(within(list.find((c) => c.getAttribute('data-status') === 'in_review')!).getByText('În review')).toBeInTheDocument()
  })

  it('filtrul pe status restrânge analizele și acțiunile', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    await cards()
    await userEvent.click(screen.getByRole('tab', { name: /^Publicat \(1\)/ }))
    const list = await cards()
    expect(list).toHaveLength(1)
    expect(list[0]).toHaveAttribute('data-status', 'published')
    const actions = (await screen.findByRole('heading', { level: 2, name: 'Acțiuni' })).closest('section')!
    expect(within(actions).getAllByRole('row')).toHaveLength(3) // antet + 2 acțiuni
  })

  it('acțiunile au responsabil, termen și status', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const actions = (await screen.findByRole('heading', { level: 2, name: 'Acțiuni' })).closest('section')!
    const table = await within(actions).findByRole('table')
    expect(within(table).getByText('În lucru')).toBeInTheDocument()
    expect(within(table).getByText('Deschisă')).toBeInTheDocument()
    expect(within(table).getByText('Finalizată')).toBeInTheDocument()
    expect(within(table).getAllByText('Andrei Vasile').length).toBeGreaterThan(0)
  })
})

describe('Analize și acțiuni — vederea clientului', () => {
  it('doar analizele publicate, fără badge de status și fără filtru pe status', async () => {
    renderApp({ route: URINAL, role: 'client_viewer' })
    await pageReady('Analize și acțiuni')
    const list = await cards()
    expect(list.map((c) => c.getAttribute('data-status'))).toEqual(['published'])
    expect(within(list[0]!).queryByText('Publicat')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Status analiză' })).toBeNull()
    const actions = (await screen.findByRole('heading', { level: 2, name: 'Acțiuni' })).closest('section')!
    expect(within(actions).queryByText('Finalizată')).toBeNull() // acțiunea din analiza înlocuită nu se vede
  })

  it('chiar dacă providerul ar greși, o analiză nepublicată nu se randează', async () => {
    renderApp({
      route: URINAL,
      role: 'client_viewer',
      wrap: (b) => ({ ...b, insights: { list: async (ctx) => { const r = await b.insights.list({ ...ctx }); return r } } }),
    })
    await pageReady('Analize și acțiuni')
    expect((await cards()).every((c) => c.getAttribute('data-status') === 'published')).toBe(true)
  })
})

describe('Analize și acțiuni — stări', () => {
  it('cu providerul real: „Sursă neconectată" cu motiv', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, insights: createSupabaseProviders().insights }) })
    await pageReady('Analize și acțiuni')
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText('Analizele nu sunt încă disponibile pentru acest brand.')).toBeInTheDocument()
  })

  it('listă goală: mesaj diferit pentru agenție și pentru client', async () => {
    const empty = (b: Parameters<NonNullable<Parameters<typeof renderApp>[0]['wrap']>>[0]) => ({ ...b, insights: { list: async () => ({ kind: 'ready' as const, data: [] }) } })
    renderApp({ route: URINAL, wrap: empty })
    expect(await screen.findByText(/nici măcar ciornă/)).toBeInTheDocument()
  })

  it('dovezile atașate deschid EvidenceDrawer', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const published = (await cards()).find((c) => c.getAttribute('data-status') === 'published')!
    await userEvent.click(within(published).getAllByRole('button')[0]!)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
