import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Evidence, MetricDefinition, ProviderResult } from '../contracts'
import { evidenceQuery, metric, warning } from '../test/factories'
import { EvidenceDrawer, type EvidenceDrawerProps } from './EvidenceDrawer'

const definition: MetricDefinition = {
  metric_key: 'ga4_sessions',
  version: 1,
  label: 'Sesiuni',
  formula: 'Numărul de sesiuni GA4 în perioadă; suma zilelor.',
  unit: 'count',
  source: 'ga4',
  aggregation_label: null,
  direction: 'higher_is_better',
  lifecycle: 'active',
  lifecycle_note: null,
  doc_ref: 'docs/metrics/registry.md#ga4_sessions',
}
const evidence: Evidence = {
  evidence_query: evidenceQuery(),
  metric_key: 'ga4_sessions',
  total_records: 28,
  records: [
    { id: 'r1', fields: { date: '5 oct.', sessions: 120 } },
    { id: 'r2', fields: { date: '4 oct.', sessions: null } },
  ],
  columns: [{ key: 'date', label: 'Dată' }, { key: 'sessions', label: 'Sessions' }],
  imported_at: '2026-10-05T09:00:00+03:00',
  payload_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
}

function setup(over: Partial<EvidenceDrawerProps> = {}) {
  const onClose = vi.fn()
  render(
    <EvidenceDrawer
      open
      onClose={onClose}
      page="Overview"
      label="Sesiuni"
      metric={metric()}
      definition={definition}
      period={{ from: '2026-09-08', to: '2026-10-05' }}
      evidence={{ kind: 'ready', data: evidence }}
      {...over}
    />,
  )
  return { onClose }
}

describe('EvidenceDrawer', () => {
  it('nu randează când e închis', () => {
    render(<EvidenceDrawer open={false} onClose={() => {}} page="x" label="x" metric={null} definition={null} period={{ from: '2026-09-08', to: '2026-10-05' }} evidence={null} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('arată definiția, sursa, intervalul, „Date până la", acoperirea și formula', () => {
    setup()
    const dlg = screen.getByRole('dialog', { name: 'Dovezi' })
    expect(dlg).toHaveTextContent('Google Analytics 4')
    expect(dlg).toHaveTextContent(/8 sept\.?\s-\s5 oct\.?\s2026/)
    expect(dlg).toHaveTextContent('Date până la')
    expect(dlg).toHaveTextContent('Complet')
    expect(dlg).toHaveTextContent('Cum se calculează')
    expect(dlg).toHaveTextContent('Numărul de sesiuni GA4 în perioadă; suma zilelor.')
    expect(dlg).toHaveTextContent('v1')
    expect(dlg).toHaveTextContent('docs/metrics/registry.md#ga4_sessions')
  })

  it('înregistrări: ultimele N din total, lipsa ca „Fără date", „Importat la" și hash', () => {
    setup()
    expect(screen.getByText(/Cele mai recente 2 din/)).toBeInTheDocument()
    expect(screen.getByText('28')).toBeInTheDocument()
    expect(screen.getByText('Fără date')).toBeInTheDocument()
    expect(screen.getByText('Importat la')).toBeInTheDocument()
    expect(screen.getByText(/a1b2c3d4e5f60718/)).toBeInTheDocument()
  })

  it('copiază hash-ul întreg', async () => {
    const onCopyHash = vi.fn()
    setup({ onCopyHash })
    await userEvent.click(screen.getByRole('button', { name: 'Copiază hash' }))
    expect(onCopyHash).toHaveBeenCalledWith('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  })

  it('loading: schelet pentru înregistrări', () => {
    setup({ evidence: null })
    expect(screen.getByRole('status', { name: 'Se încarcă dovezile' })).toBeInTheDocument()
  })

  it('fără înregistrări: explică', () => {
    setup({ evidence: { kind: 'ready', data: { ...evidence, records: [], total_records: 0 } } })
    expect(screen.getByText('Nu există înregistrări pentru acest interval.')).toBeInTheDocument()
  })

  it('sursă neconectată: motiv, fără valori estimate, acțiune de conectare', async () => {
    const onClick = vi.fn()
    const ev: ProviderResult<Evidence> = { kind: 'not_connected', reason: 'GA4 nu e conectat pentru Urinal.' }
    setup({ metric: metric({ status: 'not_connected', value: null, absolute_change: null, relative_change: null }), evidence: ev, connectAction: { label: 'Conectează GA4', onClick } })
    expect(screen.getAllByText(/GA4 nu e conectat pentru Urinal\./).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Sursa Google Analytics 4 nu este conectată/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Nu afișăm valori estimate/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Conectează GA4' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('eroare: mesaj și „Reîncearcă"', async () => {
    const onRetry = vi.fn()
    setup({ evidence: { kind: 'error', message: 'Timeout.' }, onRetry })
    expect(screen.getByText('Nu am putut încărca dovezile')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('definiție provizorie: avertisment cu nota, și calificativul agregării', () => {
    setup({ definition: { ...definition, lifecycle: 'draft', lifecycle_note: 'Unitatea se confirmă pe payload.', aggregation_label: 'medie în perioadă' } })
    expect(screen.getByText('Definiție provizorie.')).toBeInTheDocument()
    expect(screen.getByText(/Unitatea se confirmă pe payload\./)).toBeInTheDocument()
    expect(screen.getByText('medie în perioadă')).toBeInTheDocument()
  })

  it('arată notele din avertismente', () => {
    setup({ metric: metric({ warnings: [warning('incomplete_period', { severity: 'info' })] }) })
    expect(screen.getByText('Perioadă incompletă.')).toBeInTheDocument()
  })

  it('se închide cu Esc', async () => {
    const { onClose } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
