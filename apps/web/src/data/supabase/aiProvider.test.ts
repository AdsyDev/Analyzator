import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseAi } from './aiProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }

describe('createSupabaseAi', () => {
  it('engines: rata și numărătorii vin de la server; filtrul de grup trece mai departe', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { connected: true, engines: [{ engine: 'chatgpt', mention_rate: 44.4, delta_pp: null, valid_answers: 9, total_answers: 10, status: 'insufficient_sample' }] } }) })
    const r = await createSupabaseAi(client).engines(ctx, { engine: null, group: 'Criterii' })
    expect(rpcs[0]).toMatchObject({ fn: 'brand_ai_engines', args: { p_group: 'Criterii' } })
    expect(r.kind === 'ready' && r.data[0]).toMatchObject({ engine: 'chatgpt', valid_answers: 9, status: 'insufficient_sample' })
  })

  it('un engine necunoscut încalcă contractul', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: true, engines: [{ engine: 'claude', valid_answers: 1, total_answers: 1, status: 'ok' }] } }) })
    expect((await createSupabaseAi(client).engines(ctx, { engine: null, group: null })).kind).toBe('error')
  })

  it('fără SEOmonitor: „Sursă neconectată” pe fiecare secțiune', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    const p = createSupabaseAi(client)
    for (const r of await Promise.all([p.trends(ctx, { engine: null, group: null }), p.topicMatrix(ctx, { engine: null, group: null }), p.citedSources(ctx, { engine: null, group: null }), p.answers(ctx, { engine: null, group: null }, { page: 1, page_size: 20 })])) {
      expect(r.kind).toBe('not_connected')
    }
  })

  it('răspunsul: refuzul rămâne refuz; un rezultat inexistent dă eroare, nu un răspuns gol', async () => {
    const detail = { id: 'a1', question: 'q', engine: 'gemini', group: 'g', collected_at: '2026-10-05T00:00:00+03:00', outcome: 'refused', pv_flag: null, collection_note: null, segments: [], citations: [], entities_present: [], entities_recommended: [] }
    const ok = fakeDataClient({ rpc: () => ({ data: detail }) })
    expect((await createSupabaseAi(ok.client).answer('b1', 'a1'))).toMatchObject({ kind: 'ready', data: { outcome: 'refused' } })
    const none = fakeDataClient({ rpc: () => ({ data: null }) })
    expect((await createSupabaseAi(none.client).answer('b1', 'x')).kind).toBe('error')
  })
})
