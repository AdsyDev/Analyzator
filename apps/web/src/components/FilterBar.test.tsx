import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { QueryContext } from '../contracts'
import type { FilterDef } from '../lib/period'
import { FilterBar } from './FilterBar'

const NOW = new Date('2026-10-06T07:00:00Z')
const defs: FilterDef[] = [
  { key: 'device', label: 'Device', defaultValue: 'all', options: [{ value: 'all', label: 'Toate' }, { value: 'mobile', label: 'Mobil' }] },
]
const base: QueryContext = {
  brandId: 'b1',
  period: { preset: '28d', from: '2026-09-08', to: '2026-10-05' },
  comparison: 'previous',
  filters: { device: 'all' },
}

function setup(value: QueryContext = base, extra: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  const onChange = vi.fn()
  const onReset = vi.fn()
  render(<FilterBar value={value} onChange={onChange} onReset={onReset} filterDefs={defs} now={NOW} {...extra} />)
  return { onChange, onReset }
}

describe('FilterBar', () => {
  it('arată perioada și comparația cu intervalele lor reale', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Perioadă' })).toHaveTextContent('Ultimele 28 de zile')
    expect(screen.getByRole('button', { name: 'Perioadă' })).toHaveTextContent(/8 sept\.?\s-\s5 oct\.?\s2026/)
    expect(screen.getByRole('button', { name: 'Comparație' })).toHaveTextContent(/11 aug\.?\s-\s7 sept\.?\s2026/)
  })

  it('nu ține stare proprie: schimbarea cere onChange, afișajul rămâne la valoarea primită', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Perioadă' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Ultimele 7 zile/ }))
    expect(onChange).toHaveBeenCalledWith({ period: { preset: '7d', from: '2026-09-29', to: '2026-10-05' } })
    expect(screen.getByRole('button', { name: 'Perioadă' })).toHaveTextContent('Ultimele 28 de zile')
  })

  it('meniul se închide cu Esc și restituie focusul', async () => {
    setup()
    const btn = screen.getByRole('button', { name: 'Perioadă' })
    await userEvent.click(btn)
    expect(screen.getByRole('menu', { name: 'Perioadă' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveFocus()
  })

  it('săgețile mută focusul în meniu', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Perioadă' }))
    expect(screen.getByRole('menuitemradio', { name: /Ultimele 28 de zile/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /Luna curentă/ })).toHaveFocus()
  })

  it('anul trecut e dezactivat implicit (serverul nu îl calculează încă), cu motiv', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Comparație' }))
    const opt = screen.getByRole('menuitemradio', { name: 'Anul trecut' })
    expect(opt).toBeDisabled()
    expect(opt).toHaveAttribute('title', 'Comparația cu anul trecut nu e disponibilă încă pentru acest interval.')
  })

  it('anul trecut se poate activa explicit (de ex. când providerul îl servește)', async () => {
    const { onChange } = setup(base, { yearAgoAvailable: true })
    await userEvent.click(screen.getByRole('button', { name: 'Comparație' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Anul trecut' }))
    expect(onChange).toHaveBeenCalledWith({ comparison: 'year_ago' })
  })

  it('pentru „Luna curentă" arată comparația MTD, ca la server', () => {
    setup({ ...base, period: { preset: 'month', from: '2026-10-01', to: '2026-10-05' } })
    expect(screen.getByRole('button', { name: 'Comparație' })).toHaveTextContent(/1 sept\.?\s-\s5 sept\.?\s2026/)
  })

  it('filtrele modulului merg prin onChange, cu valorile existente păstrate', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Device' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Mobil' }))
    expect(onChange).toHaveBeenCalledWith({ filters: { device: 'mobile' } })
  })

  it('fără filtre active nu apar chipuri și nici „Resetează filtrele"', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Resetează filtrele' })).toBeNull()
  })

  it('chipuri pentru filtrele active, eliminabile, și resetare', async () => {
    const value: QueryContext = { ...base, comparison: 'year_ago', period: { preset: '7d', from: '2026-09-29', to: '2026-10-05' }, filters: { device: 'mobile' } }
    const { onChange, onReset } = setup(value)
    const group = screen.getByRole('group', { name: 'Filtre active' })
    expect(within(group).getByText('Ultimele 7 zile')).toBeInTheDocument()
    expect(within(group).getByText('vs anul trecut')).toBeInTheDocument()
    expect(within(group).getByText('Device: Mobil')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Elimină filtrul Device: Mobil' }))
    expect(onChange).toHaveBeenCalledWith({ filters: { device: 'all' } })
    await userEvent.click(screen.getByRole('button', { name: 'Resetează filtrele' }))
    expect(onReset).toHaveBeenCalled()
  })

  it('interval personalizat: aplică doar un interval valid', async () => {
    const value: QueryContext = { ...base, period: { preset: 'custom', from: '2026-07-01', to: '2026-09-30' } }
    const { onChange } = setup(value)
    await userEvent.click(screen.getByRole('button', { name: 'Perioadă' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aplică intervalul' }))
    expect(onChange).toHaveBeenCalledWith({ period: { preset: 'custom', from: '2026-07-01', to: '2026-09-30' } })
  })

  it('interval inversat dezactivează „Aplică intervalul" și explică', async () => {
    const value: QueryContext = { ...base, period: { preset: 'custom', from: '2026-09-30', to: '2026-07-01' } }
    setup(value)
    await userEvent.click(screen.getByRole('button', { name: 'Perioadă' }))
    expect(screen.getByRole('button', { name: 'Aplică intervalul' })).toBeDisabled()
    expect(screen.getByText(/data de început înaintea/)).toBeInTheDocument()
  })
})
