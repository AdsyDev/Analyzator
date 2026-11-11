import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseSearch, createSupabaseTraffic } from './trafficSearchProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }

describe('createSupabaseTraffic', () => {
  it('canalele vin din brand_traffic_channels; key events lipsă rămân null', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { connected: true, data_as_of: '2026-10-07', channels: [{ channel: 'Organic Search', sessions: 90, share_pct: 75, change_pct: 0, engagement_rate: 50, key_events: null }] } }) })
    const r = await createSupabaseTraffic(client).channels(ctx, null)
    expect(rpcs[0]!.fn).toBe('brand_traffic_channels')
    expect(r.kind === 'ready' && r.data.channels[0]).toEqual({ channel: 'Organic Search', sessions: 90, share_pct: 75, change_pct: 0, engagement_rate: 50, key_events: null })
  })

  it('cu un device ales nu arătăm canale nefiltrate (GA4 nu e pe device)', async () => {
    const { client, rpcs } = fakeDataClient()
    expect((await createSupabaseTraffic(client).channels(ctx, 'mobile')).kind).toBe('not_connected')
    expect(rpcs).toHaveLength(0)
  })

  it('Clarity pe device: un status necunoscut încalcă contractul', async () => {
    const cells = { desktop: { value: null, status: 'unavailable' }, mobile: { value: 3, status: 'ok' }, tablet: { value: null, status: 'inventat' } }
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: true, rows: [{ metric_key: 'clarity_rage_click_sessions', cells }] } }) })
    expect((await createSupabaseTraffic(client).clarityDevices(ctx)).kind).toBe('error')
  })

  it('AI referrals: sursele și versiunea regulilor vin de la server; valorile lipsă rămân null', async () => {
    const data = { connected: true, rules_version: 'v1', rules_effective_from: '2026-11-11', data_as_of: '2026-10-05', sources: [{ domain: 'chatgpt.com', sessions: '13', key_events: 3, conversion_rate: null }, { domain: 'perplexity.ai', sessions: 10, key_events: null, conversion_rate: null }] }
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data }) })
    const r = await createSupabaseTraffic(client).aiReferrals(ctx)
    expect(rpcs[0]).toEqual({ fn: 'brand_ai_referrals', args: { p_brand_id: 'b1', p_start: '2026-09-10', p_end: '2026-10-07' } })
    expect(r.kind === 'ready' && r.data).toEqual({ rules_version: 'v1', rules_effective_from: '2026-11-11', data_as_of: '2026-10-05', sources: [{ domain: 'chatgpt.com', sessions: 13, key_events: 3, conversion_rate: null }, { domain: 'perplexity.ai', sessions: 10, key_events: null, conversion_rate: null }] })
  })

  it('AI referrals: GA4 neconectat = „Sursă neconectată”; fără versiunea regulilor, contractul e încălcat', async () => {
    const off = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    expect((await createSupabaseTraffic(off.client).aiReferrals(ctx)).kind).toBe('not_connected')
    const bad = fakeDataClient({ rpc: () => ({ data: { connected: true, sources: [] } }) })
    expect((await createSupabaseTraffic(bad.client).aiReferrals(ctx)).kind).toBe('error')
  })

  it('calitatea trackingului: starea vine de la server, textul explică cifra', async () => {
    const checks = [
      { id: 'key_events', status: 'warning', event_names: 0 },
      { id: 'daily_coverage', status: 'warning', covered_days: 4, expected_days: 5 },
      { id: 'reconciliation', status: 'warning', difference_pct: -1.7, tolerance_pct: 1, period_start: '2026-09-28', period_end: '2026-10-04' },
      { id: 'unassigned', status: 'ok', share_pct: 3.1, threshold_pct: 10 },
      { id: 'landing_not_set', status: 'unknown', share_pct: null, threshold_pct: 10 },
    ]
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { connected: true, checked_at: '2026-10-06T05:00:00Z', checks } }) })
    const r = await createSupabaseTraffic(client).trackingQuality(ctx)
    expect(rpcs[0]!.fn).toBe('brand_tracking_quality')
    if (r.kind !== 'ready') throw new Error('așteptam date')
    expect(r.data.checked_at).toBe('2026-10-06T05:00:00Z')
    expect(r.data.checks.map((c) => [c.id, c.status])).toEqual([['key_events', 'warning'], ['daily_coverage', 'warning'], ['reconciliation', 'warning'], ['unassigned', 'ok'], ['landing_not_set', 'unknown']])
    expect(r.data.checks[0]!.note).toMatch(/Niciun eveniment cheie/)
    expect(r.data.checks[1]!.note).toMatch(/^1 zi din 5 fără nicio sesiune/)
    expect(r.data.checks[2]!.note).toMatch(/diferă cu 1,7/)
    expect(r.data.checks[3]!.note).toMatch(/3,1/)
    expect(r.data.checks[4]!.note).toBe('Fără sesiuni în perioadă.')
  })

  it('calitatea trackingului: fără colectare nu există verificări; o verificare sau o stare necunoscută încalcă contractul', async () => {
    const none = fakeDataClient({ rpc: () => ({ data: { connected: true, checked_at: null, checks: [] } }) })
    expect((await createSupabaseTraffic(none.client).trackingQuality(ctx)).kind).toBe('not_connected')
    const off = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    expect((await createSupabaseTraffic(off.client).trackingQuality(ctx)).kind).toBe('not_connected')
    for (const check of [{ id: 'inventat', status: 'ok' }, { id: 'key_events', status: 'excelent' }]) {
      const bad = fakeDataClient({ rpc: () => ({ data: { connected: true, checked_at: '2026-10-06T05:00:00Z', checks: [check] } }) })
      expect((await createSupabaseTraffic(bad.client).trackingQuality(ctx)).kind).toBe('error')
    }
  })
})

describe('createSupabaseSearch', () => {
  it('keywords: filtrul trece la server; poziția lipsă rămâne null', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { connected: true, keywords: [{ id: '102', keyword: 'urinal', url: '', volume: 2400, volume_as_of: '2026-10-07', rank_mobile: null, rank_desktop: null, change_mobile: null, is_brand: true, competitor: null, shared: false }] } }) })
    const r = await createSupabaseSearch(client).keywords(ctx, { keywordType: 'brand' })
    expect(rpcs[0]!.args).toMatchObject({ p_keyword_type: 'brand' })
    expect(r.kind === 'ready' && r.data[0]!.rank_mobile).toBeNull()
  })

  it('fără conexiune: „Sursă neconectată”; golurile de conținut nu se inventează', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    expect((await createSupabaseSearch(client).landingPages(ctx)).kind).toBe('not_connected')
    expect((await createSupabaseSearch(client).contentGaps(ctx)).kind).toBe('not_connected')
  })
})
