import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ChartSeries } from '../lib/chartData'
import { TrendChart } from './TrendChart'
import { MissingDataProvider } from './MissingData'

const labels = ['1 oct.', '2 oct.', '3 oct.', '4 oct.', '5 oct.']
const series: ChartSeries[] = [
  { key: 'a', name: 'Clicks', color: 'var(--accent)', values: [10, 20, null, null, 30] },
  { key: 'b', name: 'Sessions', color: 'var(--lav)', values: [5, 0, null, null, 8] },
]

describe('TrendChart', () => {
  it('loading: schelet', () => {
    render(<TrendChart title="Trafic" series={[]} labels={[]} loading />)
    expect(screen.getByRole('status', { name: 'Se încarcă graficul' })).toBeInTheDocument()
  })

  it('error: mesaj, diferit de lipsa datelor', () => {
    render(<TrendChart title="Trafic" series={series} labels={labels} error="Timeout." />)
    expect(screen.getByText('Nu am putut încărca graficul')).toBeInTheDocument()
    expect(screen.getByText('Timeout.')).toBeInTheDocument()
  })

  it('fără nicio valoare: „Fără date pentru perioada selectată", nu o linie la zero', () => {
    render(<TrendChart title="Trafic" labels={labels} series={[{ ...series[0]!, values: [null, null, null, null, null] }]} />)
    expect(screen.getByText('Fără date pentru perioada selectată')).toBeInTheDocument()
  })

  it('fără sursă (decizia AG): graficul nu se desenează; pagina spune pentru ce nu avem date, motivul în tooltip', () => {
    render(
      <MissingDataProvider>
        <TrendChart title="Trafic" labels={[]} series={[]} unavailableReason="GA4 nu e conectat." />
      </MissingDataProvider>,
    )
    expect(screen.queryByText(/Sursă neconectată/)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Pentru perioada selectată nu avem date pentru această pagină.')
    expect(screen.getByText('această pagină')).toHaveAttribute('title', 'GA4 nu e conectat.')
  })

  it('ready: marchează zilele fără date ca gol, nu ca zero', () => {
    render(<TrendChart title="Trafic" series={series} labels={labels} />)
    const gaps = screen.getAllByTestId('chart-gap')
    expect(gaps).toHaveLength(1)
    expect(screen.getByText('Fără date')).toBeInTheDocument()
  })

  it('tastatură: tooltipul arată „Fără date" pentru null și 0 pentru zero real', async () => {
    render(<TrendChart title="Trafic" series={series} labels={labels} />)
    const chart = screen.getByRole('group', { name: /Trafic\. Folosește săgețile/ })
    chart.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}') // 2 oct.: Sessions = 0 real
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sessions0')
    await userEvent.keyboard('{ArrowRight}') // 3 oct.: lipsă
    expect(screen.getByRole('tooltip')).toHaveTextContent('ClicksFără date')
    expect(screen.getByRole('tooltip')).toHaveTextContent('SessionsFără date')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('golul seriei principale rămâne hașurat chiar dacă seria de comparație are date în acele zile', () => {
    const primary: ChartSeries = { key: 'p', name: 'Clicks', color: 'var(--accent)', values: [10, null, null, 20, 30] }
    const comparison: ChartSeries = { key: 'c', name: 'Comparație', color: 'var(--c1)', dashed: true, values: [8, 9, 10, 11, 12] }
    render(<TrendChart title="Trafic" series={[primary, comparison]} labels={labels} />)
    expect(screen.getAllByTestId('chart-gap')).toHaveLength(1)
  })

  it('serie săptămânală: punct la fiecare colectare, fără hașură între colectări; hașură doar pentru o colectare lipsă', async () => {
    const days = Array.from({ length: 36 }, (_, i) => `${i + 1} oct.`)
    const values: Array<number | null> = days.map(() => null)
    for (const i of [0, 7, 14, 28, 35]) values[i] = 40 + i // ziua 21 lipsește
    render(<TrendChart title="SoV" labels={days} format="pct" cadenceDays={7} series={[{ key: 'sov', name: 'SoV', color: 'var(--accent)', values }]} />)
    expect(screen.getAllByTestId('chart-point')).toHaveLength(5)
    expect(screen.getAllByTestId('chart-gap')).toHaveLength(1)
    const chart = screen.getByRole('group', { name: /SoV\. Folosește săgețile/ })
    chart.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}') // sare din colectare în colectare: 1 oct., apoi 8 oct.
    expect(screen.getByRole('tooltip')).toHaveTextContent('8 oct.')
    expect(screen.getByRole('tooltip')).toHaveTextContent('47,0 %')
  })

  it('serie zilnică: o valoare izolată între goluri rămâne vizibilă ca punct', () => {
    render(<TrendChart title="Trafic" labels={labels} series={[{ key: 'a', name: 'Clicks', color: 'var(--accent)', values: [null, 5, null, 7, 8] }]} />)
    expect(screen.getAllByTestId('chart-point')).toHaveLength(1)
    expect(screen.getAllByTestId('chart-gap')).toHaveLength(2)
  })

  it('serii egale: hașura apare doar în zilele în care nicio serie nu are date, nu după prima serie', () => {
    const a: ChartSeries = { key: 'a', name: 'ChatGPT', color: 'var(--accent)', values: [20, null, null, null, null] }
    const b: ChartSeries = { key: 'b', name: 'AI Overviews', color: 'var(--lav)', values: [3, 4, 4, 5, null] }
    render(<TrendChart title="Engine" labels={labels} format="pct" series={[a, b]} />)
    expect(screen.getAllByTestId('chart-gap')).toHaveLength(1) // doar 5 oct.
    expect(screen.getAllByTestId('chart-point')).toHaveLength(1) // valoarea singură a ChatGPT
  })

  it('prag pe fiecare engine: finalul fără AI Overviews (zilnic) e hașurat chiar dacă Gemini e săptămânal', () => {
    const days = Array.from({ length: 28 }, (_, i) => `${i + 1} nov.`)
    const aio = days.map((_, i) => (i <= 21 ? 3 : null)) // zilnic, oprit după ziua 21
    const gemini = days.map((_, i) => (i % 7 === 2 && i <= 16 ? 10 : null)) // zilele 2, 9, 16; următoarea abia pe 23
    render(<TrendChart title="Engine" labels={days} format="pct" cadenceDays={7} series={[
      { key: 'g', name: 'Gemini', color: 'var(--lav)', values: gemini },
      { key: 'a', name: 'AI Overviews', color: 'var(--s3)', values: aio },
    ]} />)
    // Gemini: ultima colectare în ziua 16, iar 27 − 16 = 11 atinge pragul (1,5 × 7), deci finalul nu mai e acoperit.
    // AI Overviews (prag 1) se rupe după ziua 21: zilele 22–27 nu sunt acoperite de nicio serie.
    expect(screen.getAllByTestId('chart-gap')).toHaveLength(1)
  })

  it('prag pe fiecare engine: un engine săptămânal la zi acoperă zilele dintre colectări, chiar dacă cel zilnic s-a oprit', () => {
    const days = Array.from({ length: 28 }, (_, i) => `${i + 1} nov.`)
    const aio = days.map((_, i) => (i <= 21 ? 3 : null))
    const gemini = days.map((_, i) => (i % 7 === 2 ? 10 : null)) // 2, 9, 16, 23
    render(<TrendChart title="Engine" labels={days} format="pct" cadenceDays={7} series={[
      { key: 'g', name: 'Gemini', color: 'var(--lav)', values: gemini },
      { key: 'a', name: 'AI Overviews', color: 'var(--s3)', values: aio },
    ]} />)
    expect(screen.queryAllByTestId('chart-gap')).toHaveLength(0)
  })

  it('serie zilnică continuă: fără puncte pe fiecare zi', () => {
    render(<TrendChart title="Trafic" labels={labels} cadenceDays={7} series={[{ key: 'a', name: 'Clicks', color: 'var(--accent)', values: [1, 2, 3, 4, 5] }]} />)
    expect(screen.queryAllByTestId('chart-point')).toHaveLength(0)
  })

  it('legenda ascunde și arată seriile', async () => {
    render(<TrendChart title="Trafic" series={series} labels={labels} />)
    const btn = screen.getByRole('button', { name: 'Sessions' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('tabel alternativ: aceleași valori, lipsa ca „Fără date"', async () => {
    render(<TrendChart title="Trafic" series={series} labels={labels} />)
    await userEvent.click(screen.getByRole('button', { name: 'Vezi ca tabel' }))
    const table = screen.getByRole('table', { name: 'Trafic' })
    expect(table).toBeInTheDocument()
    expect(screen.getAllByText('Fără date')).toHaveLength(4) // 2 zile x 2 serii
    expect(screen.getByRole('button', { name: 'Vezi graficul' })).toBeInTheDocument()
  })
})
