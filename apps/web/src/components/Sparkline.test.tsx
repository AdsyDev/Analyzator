import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  it('desenează seria cu numele ei accesibil', () => {
    render(<Sparkline label="Evoluție: Clicks" values={[3, 5, 4, 8]} />)
    const img = screen.getByRole('img', { name: 'Evoluție: Clicks' })
    expect(img.querySelectorAll('path[fill="none"]')).toHaveLength(1)
  })

  it('o zi fără date întrerupe linia: două porțiuni, niciuna prin zero', () => {
    render(<Sparkline label="Serie" values={[3, 5, null, 4, 8]} />)
    const lines = screen.getByRole('img', { name: 'Serie' }).querySelectorAll('path[fill="none"]')
    expect(lines).toHaveLength(2)
  })

  it('fără nicio valoare nu desenează nimic', () => {
    const { container } = render(<Sparkline label="Serie" values={[null, null]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
