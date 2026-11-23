import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { notConnected, ready } from '../../contracts'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp } from '../../test/renderApp'

const URINAL = '/brands/brand-urinal/competition'

describe('Concurență', () => {
  it('matricea arată versiunea setului, data efectivă și grupurile', async () => {
    renderApp({ route: URINAL })
    await pageReady('Concurență')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Matricea comparativă' })).closest('section')!
    const table = await within(s).findByRole('table')
    expect(table).toBeInTheDocument()
    expect(s).toHaveTextContent(/Set de competitori v\d+/)
    expect(s).toHaveTextContent(/AI/)
    expect(s).toHaveTextContent(/SEO/)
    expect(s).toHaveTextContent(/N\/A/)
  })

  it('tabelul „Unde apare concurența și noi lipsim" se încarcă', async () => {
    renderApp({ route: URINAL })
    await pageReady('Concurență')
    const s = (await screen.findByRole('heading', { level: 2, name: /Unde apare concurența/ })).closest('section')!
    expect(await within(s).findAllByRole('row')).not.toHaveLength(0)
  })

  it('cu providerul real: „Sursă neconectată" cu motiv, fără date', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, competition: createSupabaseProviders().competition }) })
    await pageReady('Concurență')
    expect((await screen.findAllByText(/neconectat/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('table', { name: 'Comparație cu competitorii' })).toBeNull()
  })

  it('reclamele competitorilor: fără colectare, „Sursă neconectată” cu motivul', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, competition: { ...b.competition, ads: async () => notConnected('Reclamele competitorilor nu au fost încă colectate din Google Ads Transparency Center.') } }) })
    await pageReady('Concurență')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Reclamele competitorilor' })).closest('section')!
    expect(await within(s).findByText(/nu au fost încă colectate/)).toBeInTheDocument()
    expect(within(s).queryByRole('table')).toBeNull()
  })

  it('reclamele competitorilor: competitorul, intervalul declarat de Google, „Nouă” și linkul spre Ads Transparency', async () => {
    const ad = {
      id: 'AR1:CR1:RO', competitor_id: 'c1', competitor_name: 'Uronova', competitor_label: 'C1', advertiser_id: 'AR11111', advertiser_name: 'Uronova SRL', ad_id: 'CR1',
      format: 'video' as const, region: 'RO', first_shown: '2026-10-01', last_shown: '2026-10-05', new_in_period: true, times_shown_lower: null, times_shown_upper: null,
      source_url: 'https://adstransparency.google.com/advertiser/AR11111/creative/CR1?region=RO',
    }
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, competition: { ...b.competition, ads: async (_ctx, p) => ready({ items: [ad], total: 1, page: p.page, page_size: p.page_size, data_as_of: '2026-10-07' }) } }) })
    await pageReady('Concurență')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Reclamele competitorilor' })).closest('section')!
    const table = await within(s).findByRole('table', { name: 'Reclamele competitorilor' })
    expect(table).toHaveTextContent('Uronova')
    expect(table).toHaveTextContent('Uronova SRL')
    expect(table).toHaveTextContent('Video')
    expect(table).toHaveTextContent('Nouă în perioadă')
    expect(table).toHaveTextContent('Nepublicat')
    const link = within(table).getByRole('link', { name: 'Vezi în Ads Transparency' })
    expect(link).toHaveAttribute('href', ad.source_url)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
