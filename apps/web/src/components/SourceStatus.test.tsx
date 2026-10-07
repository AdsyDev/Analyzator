import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SourceState, SourceStatusInfo } from '../contracts'
import { SourceStatus } from './SourceStatus'

const info = (state: SourceState, over: Partial<SourceStatusInfo> = {}): SourceStatusInfo => ({
  provider: 'clarity',
  state,
  description: 'Rage clicks, dead clicks și scroll depth.',
  data_as_of: '2026-10-02',
  imported_at: '2026-10-03T06:00:00+03:00',
  note: null,
  ...over,
})

describe('SourceStatus', () => {
  it.each([
    ['connected', 'Conectat'],
    ['partial', 'Parțial'],
    ['stale', 'Învechit'],
    ['error', 'Eroare'],
    ['not_connected', 'Neconectat'],
  ] as const)('starea %s', (state, label) => {
    render(<SourceStatus info={info(state)} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('neconectat: explică impactul și nu arată date', () => {
    render(<SourceStatus info={info('not_connected', { data_as_of: null, imported_at: null })} />)
    expect(screen.getByText(/apar ca indisponibili/)).toBeInTheDocument()
    expect(screen.queryByText('Date până la')).toBeNull()
  })

  it('conectat: arată „Date până la" și „Importat la"', () => {
    render(<SourceStatus info={info('connected')} />)
    expect(screen.getByText('Date până la')).toBeInTheDocument()
    expect(screen.getByText('Importat la')).toBeInTheDocument()
  })

  it('eroarea afișează nota', () => {
    render(<SourceStatus info={info('error', { note: 'Tokenul API a expirat.' })} />)
    expect(screen.getByText('Tokenul API a expirat.')).toBeInTheDocument()
  })

  it('acțiunile apar doar pentru agenție', async () => {
    const onAction = vi.fn()
    const { rerender } = render(<SourceStatus info={info('error')} onAction={onAction} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<SourceStatus info={info('error')} canManage onAction={onAction} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reconectează' }))
    expect(onAction).toHaveBeenCalledWith('reconnect', 'clarity')
    rerender(<SourceStatus info={info('not_connected')} canManage onAction={onAction} />)
    await userEvent.click(screen.getByRole('button', { name: 'Conectează' }))
    expect(onAction).toHaveBeenLastCalledWith('connect', 'clarity')
  })
})
