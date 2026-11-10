import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SourceFreshness } from '../contracts'
import { ModuleFreshness } from './ModuleFreshness'

const NOW = new Date('2026-11-10T12:00:00Z')
const rows: SourceFreshness[] = [
  { provider: 'ga4', data_as_of: '2026-11-09', freshness: 'current' },
  { provider: 'gsc', data_as_of: '2026-10-20', freshness: 'delayed' },
]

describe('ModuleFreshness', () => {
  it('arată, pe sursă, „date până la" și starea; o sursă absentă din răspuns e „Fără date", nu ascunsă', () => {
    render(<ModuleFreshness sources={['ga4', 'gsc', 'seomonitor']} freshness={rows} now={NOW} />)
    const list = screen.getByRole('list', { name: 'Date până la, pe sursă' })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('data-freshness'))).toEqual(['current', 'delayed', 'no_data'])
    expect(items[0]).toHaveTextContent('Google Analytics 4')
    expect(items[0]).toHaveTextContent('9 nov. 2026')
    expect(items[1]).toHaveTextContent('Întârziat')
    expect(items[2]).toHaveTextContent('SEOmonitor')
    expect(items[2]).toHaveTextContent('Fără date')
    expect(items[2]).not.toHaveTextContent('date până la')
  })

  it('următoarea actualizare estimată vine din programarea surselor care au date; „Sincronizat la" apare doar când e dat', () => {
    const { rerender } = render(<ModuleFreshness sources={['ga4', 'gsc']} freshness={rows} now={NOW} />)
    // Marți 17 nov. 2026, 04:00 UTC = 06:00 în Europe/Bucharest.
    expect(screen.getByText(/Următoarea actualizare estimată/)).toHaveTextContent('17 nov. 2026, 06:00')
    expect(screen.queryByText(/Sincronizat la/)).not.toBeInTheDocument()
    rerender(<ModuleFreshness sources={['ga4', 'gsc']} freshness={rows} syncedAt="2026-11-10T04:12:00Z" now={NOW} />)
    expect(screen.getByText(/Sincronizat la/)).toHaveTextContent('10 nov. 2026, 06:12')
  })

  it('fără nicio sursă cu date nu promite o actualizare; cât se încarcă arată un schelet; un modul fără surse nu arată nimic', () => {
    const { rerender, container } = render(<ModuleFreshness sources={['clarity']} freshness={[]} now={NOW} />)
    expect(screen.queryByText(/Următoarea actualizare estimată/)).not.toBeInTheDocument()
    rerender(<ModuleFreshness sources={['clarity']} freshness={null} now={NOW} />)
    expect(screen.getByRole('status', { name: 'Se încarcă starea surselor' })).toBeInTheDocument()
    rerender(<ModuleFreshness sources={[]} freshness={rows} now={NOW} />)
    expect(container).toBeEmptyDOMElement()
  })
})
