import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ChartSeries } from '../lib/chartData'
import { TrendChart } from './TrendChart'

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

  it('fără nicio valoare: „Fără date pentru interval", nu o linie la zero', () => {
    render(<TrendChart title="Trafic" labels={labels} series={[{ ...series[0]!, values: [null, null, null, null, null] }]} />)
    expect(screen.getByText('Fără date pentru interval')).toBeInTheDocument()
  })

  it('sursă neconectată: arată motivul', () => {
    render(<TrendChart title="Trafic" labels={[]} series={[]} unavailableReason="GA4 nu e conectat." />)
    expect(screen.getByText('Sursă neconectată')).toBeInTheDocument()
    expect(screen.getByText('GA4 nu e conectat.')).toBeInTheDocument()
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
