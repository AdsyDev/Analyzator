import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('afișează titlul și motivul concret', () => {
    render(<EmptyState title="Sursă neconectată" text="Google Ads nu e conectat pentru Urinal." />)
    expect(screen.getByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText('Google Ads nu e conectat pentru Urinal.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('acțiunea apelează handlerul', async () => {
    const onClick = vi.fn()
    render(<EmptyState title="t" text="x" action={{ label: 'Conectează Google Ads', onClick }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Conectează Google Ads' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('varianta compact nu desenează un card propriu', () => {
    const { container } = render(<EmptyState compact title="t" text="x" />)
    expect(container.firstElementChild?.className).not.toMatch(/border/)
  })
})
