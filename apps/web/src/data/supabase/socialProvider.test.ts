import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseSocial } from './socialProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const report = {
  connected: true, data_as_of: '2026-10-07', imported_at: '2026-10-08T05:00:00Z', platforms: ['instagram', 'tiktok'],
  kpis: [
    { key: 'posts', value: 2, comparison_value: 1, change: 100, status: 'ok' },
    { key: 'net_growth', value: null, comparison_value: null, change: null, status: 'unavailable' },
    { key: 'reach', value: null, comparison_value: null, change: null, status: 'unavailable' },
  ],
  posts: [
    { id: 'tiktok:p2', published_at: '2026-10-06T22:30:00+00:00', platform: 'tiktok', excerpt: 'nouă', permalink: null, age_days: 1, mature: false, reach: null, impressions: null, interactions: null },
    { id: 'instagram:p1', published_at: '2026-10-01T10:00:00+00:00', platform: 'instagram', excerpt: 'prima', permalink: 'https://ig.test/p1', age_days: 6, mature: false, reach: null, impressions: '180', interactions: 9 },
  ],
}

describe('createSupabaseSocial', () => {
  it('un singur apel brand_social pentru KPI-uri, postări și calendar; valorile vin de la server', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: report }) })
    const p = createSupabaseSocial(client)
    const [s, posts, cal] = await Promise.all([p.summary(ctx, { platform: null, format: null }), p.posts(ctx, { platform: null, format: null }), p.calendar(ctx, { platform: null, format: null })])
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0]!.args).toMatchObject({ p_brand_id: 'b1', p_platform: null, p_start: '2026-09-10', p_end: '2026-10-07' })
    expect(s.kind === 'ready' && s.data.kpis.map((k) => [k.key, k.value, k.status])).toEqual([['posts', 2, 'ok'], ['net_growth', null, 'unavailable'], ['reach', null, 'unavailable']])
    expect(posts.kind === 'ready' && posts.data[1]).toMatchObject({ id: 'instagram:p1', impressions: 180, interactions: 9, format: null, topic: null })
    expect(posts.kind === 'ready' && posts.data[0]!.interactions).toBeNull()
    // Ziua în Europe/Bucharest: 22:30 UTC pe 6 octombrie este 7 octombrie.
    expect(cal.kind === 'ready' && cal.data.map((c) => [c.date, c.has_performance])).toEqual([['2026-10-07', false], ['2026-10-01', true]])
  })

  it('fără Planable: „Sursă neconectată”, nu zero', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    expect((await createSupabaseSocial(client).summary(ctx, { platform: null, format: null })).kind).toBe('not_connected')
  })

  it('formatul, subiectul și concurența nu se inventează', async () => {
    const { client, rpcs } = fakeDataClient()
    const p = createSupabaseSocial(client)
    expect((await p.groups(ctx, { platform: null, format: null })).kind).toBe('not_connected')
    expect((await p.competitors(ctx)).kind).toBe('not_connected')
    expect(rpcs).toHaveLength(0)
  })

  it('o platformă necunoscută în postări încalcă contractul', async () => {
    const bad = { ...report, posts: [{ ...report.posts[0], platform: 'myspace' }] }
    const { client } = fakeDataClient({ rpc: () => ({ data: bad }) })
    expect((await createSupabaseSocial(client).posts(ctx, { platform: null, format: null })).kind).toBe('error')
  })
})
