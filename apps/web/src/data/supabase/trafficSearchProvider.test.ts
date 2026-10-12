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

  it('referral-urile AI și calitatea tracking-ului nu se inventează', async () => {
    const { client } = fakeDataClient()
    expect((await createSupabaseTraffic(client).aiReferrals(ctx)).kind).toBe('not_connected')
    expect((await createSupabaseTraffic(client).trackingQuality(ctx)).kind).toBe('not_connected')
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
