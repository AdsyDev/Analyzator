import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { metric } from '../test/factories'
import { ComparisonTable, type ComparisonColumn, type ComparisonGroup } from './ComparisonTable'

const columns: ComparisonColumn[] = [
  { key: 'brand', short: 'Urinal', full: 'Urinal', kind: 'brand' },
  { key: 'c1', short: 'C1', full: 'Cistonal', kind: 'competitor' },
  { key: 'c2', short: 'C2', full: 'UroFem Plus', kind: 'competitor' },
]
const ok = (value: number) => metric({ value, unit: 'percent', status: 'ok' })

const groups: ComparisonGroup[] = [
  {
    name: 'AI',
    source: 'SEOmonitor',
    rows: [{ key: 'mention', label: 'Mention Rate', cells: { brand: ok(30), c1: ok(42), c2: ok(18) } }],
  },
]

describe('ComparisonTable', () => {
  it('loading: schelet', () => {
    render(<ComparisonTable caption="c" columns={columns} groups={[]} loading />)
    expect(screen.getByRole('status', { name: 'Se încarcă comparația' })).toBeInTheDocument()
  })

  it('arată versiunea setului, data efectivă și „Date până la"', () => {
    render(<ComparisonTable caption="c" columns={columns} groups={groups} setVersion={3} effectiveFrom="2026-09-01" dataAsOf="2026-10-05" />)
    expect(screen.getByText('v3')).toBeInTheDocument()
    expect(screen.getByText(/1 sept\.?\s2026/)).toBeInTheDocument()
    expect(screen.getByText(/5 oct\.?\s2026/)).toBeInTheDocument()
  })

  it('marchează cea mai bună valoare, cu text pentru cititoare de ecran', () => {
    render(<ComparisonTable caption="c" columns={columns} groups={groups} />)
    const row = screen.getByRole('row', { name: /Mention Rate/ })
    expect(within(row).getByText('Cea mai bună valoare:')).toBeInTheDocument()
    expect(within(row).getByText(/42/)).toBeInTheDocument()
  })

  it('pentru metrici „mai mic e mai bun", cea mai mică valoare câștigă', () => {
    const g: ComparisonGroup[] = [{ name: 'SEO', rows: [{ key: 'pos', label: 'Poziție medie', direction: 'lower_is_better', cells: { brand: ok(8), c1: ok(3), c2: ok(12) } }] }]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    const row = screen.getByRole('row', { name: /Poziție medie/ })
    expect(within(row).getByText('Cea mai bună valoare:').parentElement).toHaveTextContent('3')
  })

  it('celula fără sursă e „N/A" cu motiv, nu 0', () => {
    const g: ComparisonGroup[] = [
      {
        name: 'Listening',
        rows: [
          {
            key: 'sov',
            label: 'Listening SoV',
            cells: {
              brand: ok(31),
              c1: metric({ status: 'not_connected', value: null, source: 'listening' }),
              c2: metric({ status: 'not_connected', value: null, source: 'listening' }),
            },
          },
        ],
      },
    ]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    expect(screen.getAllByText('N/A', { exact: false })).not.toHaveLength(0)
    expect(screen.getByText('N/A: Sursa listening nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Listening SoV/ })
    expect(within(row).queryByText('Cea mai bună valoare:')).toBeNull()
  })

  it('nu formulează un clasament când acoperirea diferă (celulă parțială)', () => {
    const g: ComparisonGroup[] = [
      { name: 'AI', rows: [{ key: 'm', label: 'Mention Rate', cells: { brand: ok(30), c1: metric({ value: 42, unit: 'percent', status: 'partial', coverage: 0.6 }), c2: ok(18) } }] },
    ]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    expect(screen.queryByText('Cea mai bună valoare:')).toBeNull()
    expect(screen.getByText('Parțial')).toBeInTheDocument()
  })

  it('direcția neutral nu marchează o cea mai bună valoare', () => {
    const g: ComparisonGroup[] = [{ name: 'AI', rows: [{ key: 'm', label: 'Poziție', direction: 'neutral', cells: { brand: ok(30), c1: ok(42), c2: ok(18) } }] }]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    expect(screen.queryByText('Cea mai bună valoare:')).toBeNull()
  })

  it('egalitatea nu marchează un câștigător', () => {
    const g: ComparisonGroup[] = [{ name: 'AI', rows: [{ key: 'm', label: 'Mention Rate', cells: { brand: ok(30), c1: ok(30), c2: ok(18) } }] }]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    expect(screen.queryByText('Cea mai bună valoare:')).toBeNull()
  })

  it('numele întreg al competitorului e accesibil, eticheta scurtă e vizuală', () => {
    render(<ComparisonTable caption="c" columns={columns} groups={groups} />)
    expect(screen.getByRole('columnheader', { name: 'Cistonal' })).toBeInTheDocument()
  })

  it('un zero real este o valoare, nu N/A', () => {
    const g: ComparisonGroup[] = [{ name: 'AI', rows: [{ key: 'm', label: 'Citări owned', cells: { brand: metric({ value: 0, unit: 'count' }), c1: metric({ value: 4, unit: 'count' }), c2: metric({ value: 2, unit: 'count' }) } }] }]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    const row = screen.getByRole('row', { name: /Citări owned/ })
    expect(within(row).getByText('0')).toBeInTheDocument()
    expect(within(row).queryByText('N/A')).toBeNull()
  })

  it('celulă cu motiv explicit (fără metrică): N/A cu motivul, nu o stare fabricată', () => {
    const why = 'Datele competitorilor nu sunt încă disponibile.'
    const g: ComparisonGroup[] = [{ name: 'AI', rows: [{ key: 'm', label: 'Mention Rate', cells: { brand: ok(30), c1: { unavailable: why }, c2: { unavailable: why } } }] }]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    const row = screen.getByRole('row', { name: /Mention Rate/ })
    expect(within(row).getAllByText(/N\/A/)).toHaveLength(2)
    expect(within(row).queryByText('Cea mai bună valoare:')).toBeNull()
    expect(screen.getAllByText(`N/A: ${why}`)).toHaveLength(1)
    expect(within(row).getByText('30 %')).toBeInTheDocument()
  })

  it('o celulă lipsă din rând nu strică tabelul și nu produce un câștigător', () => {
    const g: ComparisonGroup[] = [{ name: 'AI', rows: [{ key: 'm', label: 'Mention Rate', cells: { brand: ok(30), c1: ok(10) } }] }]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    const row = screen.getByRole('row', { name: /Mention Rate/ })
    expect(within(row).queryByText('Cea mai bună valoare:')).toBeNull()
    expect(within(row).getAllByText('N/A')).toHaveLength(1)
  })

  it('celulă din matricea de Concurență (CompetitionCell): valoare, parțial cu motiv în subsol, N/A cu motiv', () => {
    const g: ComparisonGroup[] = [
      {
        name: 'SEO',
        rows: [
          {
            key: 'k',
            label: 'Keywords în Top 10',
            definition: 'Numărul de keywords în Top 10.',
            cells: {
              brand: { value: 4, unit: 'count', status: 'ok', coverage: null, reason: null },
              c1: { value: 2, unit: 'count', status: 'partial', coverage: null, reason: 'Se observă doar keywordurile în care apare.' },
              c2: { value: null, unit: 'count', status: 'not_connected', coverage: null, reason: null },
            },
          },
        ],
      },
    ]
    render(<ComparisonTable caption="c" columns={columns} groups={g} />)
    const row = screen.getByRole('row', { name: /Keywords în Top 10/ })
    expect(within(row).getByText('4')).toBeInTheDocument()
    expect(within(row).getByText('Parțial')).toBeInTheDocument()
    expect(within(row).getByText('N/A')).toBeInTheDocument()
    expect(within(row).queryByText('Cea mai bună valoare:')).toBeNull()
    expect(screen.getByText('Date parțiale: Se observă doar keywordurile în care apare.')).toBeInTheDocument()
    expect(screen.getByText('N/A: Sursă neconectată.')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Ce înseamnă Keywords în Top 10' })).toBeInTheDocument()
  })
})
