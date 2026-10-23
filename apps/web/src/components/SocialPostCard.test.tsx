import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SocialPostCard } from './SocialPostCard'

const base = { platform: 'instagram' as const, author: 'Urinal', own: true, publishedAt: '2026-10-20T09:30:00Z', href: 'https://www.instagram.com/p/abc' }

describe('SocialPostCard (E-3)', () => {
  it('antet ca pe rețea: autorul, platforma, data; linkul spre original cu noopener', () => {
    render(<SocialPostCard {...base} text="Salut!" />)
    const card = screen.getByRole('article', { name: 'Postare Instagram, Urinal' })
    expect(within(card).getByText('Urinal')).toBeInTheDocument()
    expect(within(card).getByText('Instagram')).toBeInTheDocument()
    const a = within(card).getByRole('link', { name: 'Vezi pe Instagram' })
    expect(a).toHaveAttribute('href', 'https://www.instagram.com/p/abc')
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('hashtag-urile și @mențiunile sunt evidențiate, fără să devină linkuri', () => {
    render(<SocialPostCard {...base} text="Noutate #vara2026 pentru @urinal.ro azi" />)
    const tag = screen.getByText('#vara2026')
    expect(tag.tagName).toBe('SPAN')
    expect(screen.getByText('@urinal.ro')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('textul lung se strânge, cu „Vezi tot” / „Mai puțin”', async () => {
    render(<SocialPostCard {...base} text={'cuvânt '.repeat(80)} />)
    const more = screen.getByRole('button', { name: 'Vezi tot' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(screen.getByRole('button', { name: 'Mai puțin' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('autor extern fără nume: „Autor extern”, sursa așa cum vine; fără link: „Link indisponibil”', () => {
    render(<SocialPostCard platform="forum" author="Autor extern" own={false} source="Forum Sănătatea Ta" publishedAt="2026-10-20T09:30:00Z" text="x" href={null} />)
    expect(screen.getByRole('article', { name: 'Postare Forum, Autor extern' })).toBeInTheDocument()
    expect(screen.getByText('Forum Sănătatea Ta')).toBeInTheDocument()
    expect(screen.getByText('Link indisponibil')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('o sursă care nu e rețea socială are „Deschide sursa”; acțiunile apar sub rândul de jos', () => {
    render(<SocialPostCard platform="review" author="Autor extern" own={false} source="Review farmacie online" publishedAt="2026-10-20T09:30:00Z" text="x" href="https://exemplu.ro/r/1" actions={<button type="button">Marchează</button>} />)
    expect(screen.getByRole('link', { name: 'Deschide sursa' })).toHaveAttribute('href', 'https://exemplu.ro/r/1')
    expect(screen.getByRole('button', { name: 'Marchează' })).toBeInTheDocument()
  })
})
