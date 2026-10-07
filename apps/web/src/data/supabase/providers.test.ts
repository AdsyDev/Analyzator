import { describe, expect, it } from 'vitest'
import { METRIC_STATUSES as CONTRACT_STATUSES } from '@analytics/contracts/metric-response'
import { METRIC_STATUSES, STATUSES_WITHOUT_VALUE, isAgencyRole, type QueryContext } from '../../contracts'
import { createSupabaseProviders } from './providers'

const ctx: QueryContext = {
  brandId: 'brand-1',
  period: { preset: '28d', from: '2026-09-08', to: '2026-10-05' },
  comparison: 'previous',
  filters: {},
}

describe('contractul MetricResponse', () => {
  it('statusurile sunt cele din contractul oficial (analytics/contracts), în aceeași ordine de gravitate', () => {
    expect([...METRIC_STATUSES]).toEqual([...CONTRACT_STATUSES])
    expect([...METRIC_STATUSES]).toEqual(['not_connected', 'unavailable', 'cannot_compute', 'insufficient_sample', 'stale', 'partial', 'base_zero', 'ok'])
  })

  it('doar cannot_compute, unavailable și not_connected garantează value null; partial poate avea null (zero neconfirmat)', () => {
    expect([...STATUSES_WITHOUT_VALUE].sort()).toEqual(['cannot_compute', 'not_connected', 'unavailable'])
    expect(STATUSES_WITHOUT_VALUE.has('partial')).toBe(false)
  })
})

describe('rolurile', () => {
  it('clientul nu e rol de agenție', () => {
    expect(isAgencyRole('client_viewer')).toBe(false)
    for (const r of ['agency_admin', 'strategist', 'account'] as const) expect(isAgencyRole(r)).toBe(true)
  })
})

describe('providerul supabase (gol)', () => {
  const p = createSupabaseProviders()

  it('întoarce metrici not_connected cu value null, nu zero, în ordinea cerută, fără meta inventat', async () => {
    const { items, meta } = await p.metrics.metrics(ctx, ['ai_mention_rate', 'ga4_sessions'])
    expect(items.map((m) => m.metric_key)).toEqual(['ai_mention_rate', 'ga4_sessions'])
    for (const m of items) {
      expect(m.status).toBe('not_connected')
      expect(m.value).toBeNull()
      expect(m.absolute_change).toBeNull()
      expect(m.relative_change).toBeNull()
      expect(m.coverage).toBeNull()
      expect(m.source).toBeNull()
      expect(m.warnings).toEqual([])
    }
    // Nu există răspuns de server, deci nici `tenant_id` sau `generated_at` fabricate.
    expect(meta).toBeNull()
  })

  it('cheia dovezii poartă brandul și intervalele cerute', async () => {
    const { items } = await p.metrics.metrics(ctx, ['ga4_sessions'])
    expect(items[0]?.evidence_query).toMatchObject({ metric_key: 'ga4_sessions', brand_id: 'brand-1', period: { start: '2026-09-08', end: '2026-10-05' }, comparison_period: { start: '2026-08-11', end: '2026-09-07' } })
  })

  it('cheia dovezii pentru „Luna curentă" folosește comparația MTD, ca la server', async () => {
    const { items } = await p.metrics.metrics({ ...ctx, period: { preset: 'month', from: '2026-10-01', to: '2026-10-05' } }, ['ga4_sessions'])
    expect(items[0]?.evidence_query.comparison_period).toEqual({ start: '2026-09-01', end: '2026-09-05' })
  })

  it('seriile nu conțin puncte inventate', async () => {
    const [s] = await p.metrics.trends(ctx, ['ga4_sessions'])
    expect(s?.points).toEqual([])
    expect(s?.status).toBe('not_connected')
  })

  it('listele întorc not_connected cu motiv, nu listă goală', async () => {
    const r = await p.mentions.list(ctx, { sentiment: null, source: null, page: 1, page_size: 20 })
    expect(r.kind).toBe('not_connected')
    if (r.kind === 'not_connected') expect(r.reason.length).toBeGreaterThan(0)
    expect((await p.insights.list(ctx)).kind).toBe('not_connected')
    expect((await p.sources.statuses('brand-1')).kind).toBe('not_connected')
  })

  it('se declară ca supabase', () => expect(p.kind).toBe('supabase'))
})
