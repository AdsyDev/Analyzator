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

  it('formatul și subiectul nu se inventează', async () => {
    const { client, rpcs } = fakeDataClient()
    const p = createSupabaseSocial(client)
    expect((await p.groups(ctx, { platform: null, format: null })).kind).toBe('not_connected')
    expect(rpcs).toHaveLength(0)
  })

  const cell = (value: number | null, status: string, reason: string | null = null) => ({ value, unit: 'count', status, coverage: null, reason })
  const matrix = (cells: Record<string, [ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>]>) => ({
    has_set: true,
    entities: [{ id: 'b1', name: 'Urinal', kind: 'brand', label: 'Urinal' }, { id: 'm1', name: 'Cystenal', kind: 'competitor', label: 'C1' }, { id: 'm2', name: 'Afrodor', kind: 'competitor', label: 'C2' }],
    groups: [
      { dimension: 'ai', rows: [] },
      { dimension: 'social', rows: ['social_cadence', 'social_followers', 'social_interactions_per_post'].map((key, i) => ({ key, cells: Object.fromEntries(Object.entries(cells).map(([id, c]) => [id, c[i]])) })) },
    ],
    social_as_of: { b1: '2026-10-07', m1: '2026-10-06', m2: null },
  })
  const NO_PROFILE = 'Competitorul nu are profiluri sociale în setul de competitori.'

  it('concurența publică: din matricea de Concurență (grupul social), N/A devine null; brandul nu apare', async () => {
    const data = matrix({
      b1: [cell(2, 'ok'), cell(1010, 'ok'), cell(null, 'unavailable')],
      m1: [cell(3, 'partial'), cell(206, 'partial'), cell(13.33, 'partial')],
      m2: [cell(null, 'unavailable', NO_PROFILE), cell(null, 'unavailable', NO_PROFILE), cell(null, 'unavailable', NO_PROFILE)],
    })
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data }) })
    const r = await createSupabaseSocial(client).competitors(ctx)
    expect(rpcs[0]).toMatchObject({ fn: 'brand_competition', args: { p_brand_id: 'b1', p_start: '2026-09-10', p_end: '2026-10-07' } })
    expect(r).toEqual({
      kind: 'ready',
      data: [
        { label: 'C1', name: 'Cystenal', posts_per_week: 3, followers: 206, public_interactions_per_post: 13.33, as_of: '2026-10-06' },
        { label: 'C2', name: 'Afrodor', posts_per_week: null, followers: null, public_interactions_per_post: null, as_of: null },
      ],
    })
  })

  it('concurența publică: fără set sau fără niciun profil social: „Sursă neconectată” cu motivul; contract greșit: eroare', async () => {
    const none = fakeDataClient({ rpc: () => ({ data: { has_set: false } }) })
    const r1 = await createSupabaseSocial(none.client).competitors(ctx)
    expect(r1.kind === 'not_connected' && r1.reason).toMatch(/set de competitori/)
    const unlinked = matrix({
      b1: [cell(2, 'ok'), cell(1010, 'ok'), cell(null, 'unavailable')],
      m1: [cell(null, 'unavailable', NO_PROFILE), cell(null, 'unavailable', NO_PROFILE), cell(null, 'unavailable', NO_PROFILE)],
      m2: [cell(null, 'unavailable', NO_PROFILE), cell(null, 'unavailable', NO_PROFILE), cell(null, 'unavailable', NO_PROFILE)],
    })
    const r2 = await createSupabaseSocial(fakeDataClient({ rpc: () => ({ data: unlinked }) }).client).competitors(ctx)
    expect(r2.kind === 'not_connected' && r2.reason).toMatch(/profiluri sociale/)
    const bad = matrix({ b1: [cell(1, 'ok'), cell(1, 'ok'), cell(1, 'ok')], m1: [cell(1, 'maybe'), cell(1, 'ok'), cell(1, 'ok')], m2: [cell(1, 'ok'), cell(1, 'ok'), cell(1, 'ok')] })
    expect((await createSupabaseSocial(fakeDataClient({ rpc: () => ({ data: bad }) }).client).competitors(ctx)).kind).toBe('error')
    const denied = fakeDataClient({ rpc: () => ({ error: { code: '42501', message: 'x' } }) })
    expect(await createSupabaseSocial(denied.client).competitors(ctx)).toEqual({ kind: 'error', message: 'Nu ai acces la acest spațiu de brand.' })
  })

  it('o platformă necunoscută în postări încalcă contractul', async () => {
    const bad = { ...report, posts: [{ ...report.posts[0], platform: 'myspace' }] }
    const { client } = fakeDataClient({ rpc: () => ({ data: bad }) })
    expect((await createSupabaseSocial(client).posts(ctx, { platform: null, format: null })).kind).toBe('error')
  })
})
