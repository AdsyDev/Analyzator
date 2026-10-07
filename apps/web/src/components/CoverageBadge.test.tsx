import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CoverageBadge } from './CoverageBadge'

describe('CoverageBadge', () => {
  it.each([
    ['complete', 'Complet'],
    ['partial', 'Parțial'],
    ['stale', 'Învechit'],
    ['unavailable', 'Indisponibil'],
  ] as const)('afișează starea %s', (state, text) => {
    render(<CoverageBadge state={state} pct={82} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('arată procentul doar la parțial', () => {
    const { rerender } = render(<CoverageBadge state="partial" pct={82.4} />)
    expect(screen.getByText('82%')).toBeInTheDocument()
    rerender(<CoverageBadge state="complete" pct={82} />)
    expect(screen.queryByText('82%')).toBeNull()
  })

  it('explică starea în titlu', () => {
    const { container } = render(<CoverageBadge state="partial" pct={82} />)
    expect(container.firstElementChild).toHaveAttribute('title', 'Date parțiale: 82% din zile acoperite')
  })
})
