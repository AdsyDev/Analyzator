import { describe, expect, it } from 'vitest'
import { METRIC_STATUSES, STATUSES_WITHOUT_VALUE, isAgencyRole, type QueryContext } from '../../contracts'
import { createSupabaseProviders } from './providers'

const ctx: QueryContext = {
  brandId: 'brand-1',
  period: { preset: '28d', from: '2026-09-08', to: '2026-10-05' },
  comparison: 'previous',
  filters: {},
}

describe('contractul MetricResponse', () => {
  it('are cele opt statusuri din spec cap. 26 și din metrics.compute', () => {
    expect([...METRIC_STATUSES]).toEqual(['ok', 'partial', 'stale', 'insufficient_sample', 'base_zero', 'cannot_compute', 'unavailable', 'not_connected'])
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

  it('întoarce un înveliș data+meta cu not_connected și value null, nu zero, în ordinea cerută', async () => {
    const { data, meta } = await p.metrics.metrics(ctx, ['ai_mention_rate', 'ga4_sessions'])
    expect(data.map((m) => m.metric_key)).toEqual(['ai_mention_rate', 'ga4_sessions'])
    for (const m of data) {
      expect(m.status).toBe('not_connected')
      expect(m.value).toBeNull()
      expect(m.absolute_change).toBeNull()
      expect(m.relative_change).toBeNull()
      expect(m.coverage).toBeNull()
    }
    expect(meta.brand_id).toBe('brand-1')
    expect(meta.period).toEqual({ start: '2026-09-08', end: '2026-10-05' })
    expect(meta.comparison_period).toEqual({ start: '2026-08-11', end: '2026-09-07' })
    expect(meta.data_as_of).toBeNull()
  })

  it('cheia dovezii poartă brandul și intervalele cerute', async () => {
    const { data } = await p.metrics.metrics(ctx, ['ga4_sessions'])
    expect(data[0]?.evidence_query).toMatchObject({ metric_key: 'ga4_sessions', brand_id: 'brand-1', period: { start: '2026-09-08', end: '2026-10-05' } })
  })

  it('comparația MTD din envelope urmează regula serverului', async () => {
    const { meta } = await p.metrics.metrics({ ...ctx, period: { preset: 'month', from: '2026-10-01', to: '2026-10-05' } }, ['ga4_sessions'])
    expect(meta.comparison_period).toEqual({ start: '2026-09-01', end: '2026-09-05' })
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
