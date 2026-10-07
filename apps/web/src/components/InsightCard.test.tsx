import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Insight, InsightStatus } from '../contracts'
import { evidenceQuery } from '../test/factories'
import { InsightCard } from './InsightCard'

const insight = (status: InsightStatus): Insight => ({
  id: 'i1',
  brand_id: 'b1',
  title: 'Vizibilitate AI în scădere pe criterii de alegere',
  summary: 'Vizibilitatea a scăzut în 12 întrebări.',
  author: { id: 'p1', name: 'Andreea Vlad', role: 'Strateg, AdSymphony' },
  period: { from: '2026-09-08', to: '2026-10-05' },
  status,
  evidence: [{ label: 'AI Mention Rate', evidence_query: evidenceQuery({ metric_key: 'ai_mention_rate' }) }],
  limits: 'Cohortă de 80 de răspunsuri valide.',
  actions: [],
  updated_at: '2026-10-05T10:00:00+03:00',
  published_at: status === 'published' ? '2026-10-05T10:00:00+03:00' : null,
})

describe('InsightCard', () => {
  it.each([
    ['draft', 'Draft'],
    ['in_review', 'În review'],
    ['published', 'Publicat'],
    ['superseded', 'Înlocuit'],
  ] as const)('agenția vede badge-ul %s', (status, label) => {
    render(<InsightCard insight={insight(status)} agencyView />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('clientul vede analiza publicată fără badge de status', () => {
    render(<InsightCard insight={insight('published')} />)
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.queryByText('Publicat')).toBeNull()
  })

  it.each(['draft', 'in_review', 'superseded'] as const)('clientul nu vede o analiză %s', (status) => {
    const { container } = render(<InsightCard insight={insight(status)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('arată autorul, perioada, rezumatul și limitele', () => {
    render(<InsightCard insight={insight('published')} />)
    expect(screen.getByText('Andreea Vlad')).toBeInTheDocument()
    expect(screen.getByText('Strateg, AdSymphony')).toBeInTheDocument()
    expect(screen.getByText(/8 sept\.?\s-\s5 oct\.?\s2026/)).toBeInTheDocument()
    expect(screen.getByText('Vizibilitatea a scăzut în 12 întrebări.')).toBeInTheDocument()
    expect(screen.getByText(/Cohortă de 80 de răspunsuri valide\./)).toBeInTheDocument()
  })

  it('dovezile deschid EvidenceDrawer prin cheia lor', async () => {
    const onOpenEvidence = vi.fn()
    render(<InsightCard insight={insight('published')} onOpenEvidence={onOpenEvidence} />)
    await userEvent.click(screen.getByRole('button', { name: 'AI Mention Rate' }))
    expect(onOpenEvidence).toHaveBeenCalledWith(evidenceQuery({ metric_key: 'ai_mention_rate' }))
  })

  it('fără limite și fără dovezi nu desenează secțiuni goale', () => {
    render(<InsightCard insight={{ ...insight('published'), limits: null, evidence: [] }} />)
    expect(screen.queryByText('Dovezi atașate')).toBeNull()
    expect(screen.queryByText(/Limite/)).toBeNull()
  })
})
