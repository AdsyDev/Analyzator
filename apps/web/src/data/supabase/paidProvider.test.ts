import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabasePaid } from './paidProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const report = {
  connected: true, sources: ['meta_ads'], currency: 'RON', mixed_currency: false, source_timezone: 'Europe/Bucharest', imported_at: '2026-10-08T05:00:00Z', data_as_of: '2026-10-07',
  kpis: [
    { key: 'spend', label: 'Cost', unit: 'currency', currency: 'RON', value: 70, change: 40, status: 'ok', definition: 'Suma costurilor.', note: null },
    { key: 'cpa', label: 'CPA', unit: 'currency', currency: 'RON', value: null, change: null, status: 'cannot_compute', definition: 'Cost / conversii.', note: null },
  ],
  series: [{ date: '2026-10-06', spend: null, results: null }, { date: '2026-10-07', spend: '10', results: null }],
  rows: [{ date: '2026-10-07', platform: 'meta_ads', account: 'Urinal RO', campaign: 'Toamna', objective: null, spend: '10', impressions: 100, clicks: 4, ctr: 4, cpc: 2.5, conversions: null, cpa: null, attribution_window: null }],
}

describe('createSupabasePaid', () => {
  it('un singur apel brand_paid pentru KPI-uri, serie și rânduri; valorile vin de la server', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: report }) })
    const p = createSupabasePaid(client)
    const [s, series, rows] = await Promise.all([p.summary(ctx, { platform: null }), p.series(ctx, { platform: null }), p.rows(ctx, { platform: null })])
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0]!.args).toMatchObject({ p_brand_id: 'b1', p_platform: null, p_kind: 'custom' })
    expect(s.kind === 'ready' && s.data.kpis.map((k) => [k.key, k.value, k.status])).toEqual([['spend', 70, 'ok'], ['cpa', null, 'cannot_compute']])
    expect(series.kind === 'ready' && series.data.spend).toEqual([{ date: '2026-10-06', value: null }, { date: '2026-10-07', value: 10 }])
    expect(rows.kind === 'ready' && rows.data[0]).toMatchObject({ platform: 'meta_ads', spend: 10, cpa: null })
  })

  it('fără platformă conectată: „Sursă neconectată”, nu zero', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    expect((await createSupabasePaid(client).summary(ctx, { platform: null })).kind).toBe('not_connected')
  })

  it('bugetul fără plan încărcat nu se inventează', async () => {
    const { client } = fakeDataClient()
    expect((await createSupabasePaid(client).budget(ctx)).kind).toBe('not_connected')
  })

  it('un KPI cu status necunoscut încalcă contractul', async () => {
    const bad = { ...report, kpis: [{ ...report.kpis[0], status: 'inventat' }] }
    const { client } = fakeDataClient({ rpc: () => ({ data: bad }) })
    expect((await createSupabasePaid(client).summary(ctx, { platform: null })).kind).toBe('error')
  })
})
