import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseInsights, createSupabaseMentions } from './listeningProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const mention = { id: 'h:1', brand_id: 'b1', source_name: 'instagram', author: null, published_at: '2026-10-05T12:00:00Z', text: 'bun', url: 'https://x.test/1', sentiment: null, reviewed_by: null, pv_flag: null }

describe('createSupabaseMentions', () => {
  it('lista vine din brand_mentions cu filtrele și paginarea din UI', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { items: [mention], total: 1, page: 1, page_size: 20 } }) })
    const r = await createSupabaseMentions(client).list(ctx, { sentiment: 'unreviewed', source: 'instagram', author: null, page: 1, page_size: 20 })
    expect(r.kind === 'ready' && r.data.items[0]!.sentiment).toBeNull()
    expect(rpcs[0]).toMatchObject({ fn: 'brand_mentions', args: { p_sentiment: 'unreviewed', p_source: 'instagram', p_page: 1 } })
  })

  it('fără Listening conectat: sentimentul e „Sursă neconectată”, nu zero', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false, total: 0, positive: 0, neutral: 0, negative: 0, unreviewed: 0, owned_excluded: 0, shares: { positive: null, neutral: null, negative: null } } }) })
    expect((await createSupabaseMentions(client).sentiment(ctx)).kind).toBe('not_connected')
  })

  it('cont propriu (D-22): filtrul de autor ajunge la server; fără owned_excluded, răspunsul încalcă contractul', async () => {
    const fake = fakeDataClient({ rpc: () => ({ data: { items: [], total: 1, page: 1, page_size: 20 } }) })
    await createSupabaseMentions(fake.client).list(ctx, { sentiment: null, source: null, author: 'owned', page: 1, page_size: 20 })
    expect(fake.rpcs[0]).toEqual({ fn: 'brand_mentions', args: expect.objectContaining({ p_author: 'owned' }) })
    const old = fakeDataClient({ rpc: () => ({ data: { connected: true, total: 0, positive: 0, neutral: 0, negative: 0, unreviewed: 0, shares: { positive: null, neutral: null, negative: null } } }) })
    expect((await createSupabaseMentions(old.client).sentiment(ctx)).kind).toBe('error')
  })

  it('marcarea PV trimite doar referința; textul îl completează serverul', async () => {
    const { client, calls } = fakeDataClient({ userId: 'u-12345678' })
    await createSupabaseMentions(client).pvFlag('b1', { kind: 'mention', id: 'h:1' })
    expect(calls.find((c) => c.op === 'insert')).toMatchObject({ table: 'pv_flags', payload: { brand_id: 'b1', entity_type: 'mention', entity_ref: 'h:1' } })
  })
})

describe('createSupabaseInsights', () => {
  it('analizele vin din brand_insights; un status necunoscut încalcă contractul', async () => {
    const ok = fakeDataClient({ rpc: () => ({ data: [{ id: 'i1', status: 'published', evidence: [], actions: [] }] }) })
    expect((await createSupabaseInsights(ok.client).list(ctx)).kind).toBe('ready')
    const bad = fakeDataClient({ rpc: () => ({ data: [{ id: 'i1', status: 'inventat', evidence: [], actions: [] }] }) })
    expect((await createSupabaseInsights(bad.client).list(ctx)).kind).toBe('error')
  })
})
