import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
