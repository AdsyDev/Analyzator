import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseCompetition } from './competitionProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const na = { value: null, unit: 'count', status: 'unavailable', coverage: null, reason: 'Pozițiile organice ale competitorilor nu sunt colectate.' }
const matrix = {
  has_set: true, set_version: 1, effective_from: '2026-10-01', data_as_of: '2026-10-07',
  entities: [{ id: 'b1', name: 'Urinal', kind: 'brand', label: 'Urinal' }, { id: 'c1', name: 'Uronova', kind: 'competitor', label: 'C1' }],
  groups: [{ dimension: 'seo', title: 'SEO', source: 'SEOmonitor', rows: [{ key: 'seomonitor_keywords_top10', label: 'Top 10', definition: 'x', direction: 'higher_is_better', cells: { b1: { value: '12', unit: 'count', status: 'ok', coverage: 1, reason: null }, c1: na } }] }],
}

describe('createSupabaseCompetition', () => {
  it('matricea vine din SQL; N/A al competitorului rămâne null cu motivul', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: matrix }) })
    const r = await createSupabaseCompetition(client).matrix(ctx)
    expect(r.kind).toBe('ready')
    if (r.kind !== 'ready') return
    const cells = r.data.groups[0]!.rows[0]!.cells
    expect(cells.b1!.value).toBe(12)
    expect(cells.c1).toMatchObject({ value: null, reason: 'Pozițiile organice ale competitorilor nu sunt colectate.' })
  })

  it('fără set de competitori: „Sursă neconectată” cu motivul, pe ambele secțiuni', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { has_set: false } }) })
    const p = createSupabaseCompetition(client)
    expect((await p.matrix(ctx)).kind).toBe('not_connected')
    expect((await p.gaps(ctx)).kind).toBe('not_connected')
  })

  it('o dimensiune necunoscută încalcă contractul', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { ...matrix, groups: [{ ...matrix.groups[0], dimension: 'presa' }] } }) })
    expect((await createSupabaseCompetition(client).matrix(ctx)).kind).toBe('error')
  })

  describe('reclamele competitorilor', () => {
    const ad = {
      id: 'AR11111:CR1:RO', competitor_id: 'c1', competitor_name: 'Uronova', competitor_label: 'C1', advertiser_id: 'AR11111', advertiser_name: 'Uronova SRL',
      ad_id: 'CR1', format: 'image', region: 'RO', first_shown: '2026-09-20', last_shown: '2026-10-05', new_in_period: true, times_shown_lower: 1000, times_shown_upper: 2000,
      source_url: 'https://adstransparency.google.com/advertiser/AR11111/creative/CR1?region=RO', last_seen: '2026-10-08T05:00:00Z',
    }

    it('paginare pe server: limit și offset din pagina cerută; răspunsul trece neschimbat', async () => {
      const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { has_set: true, connected: true, total: 41, data_as_of: '2026-10-07', items: [ad] } }) })
      const r = await createSupabaseCompetition(client).ads(ctx, { page: 3, page_size: 20 })
      expect(rpcs.at(-1)).toMatchObject({ fn: 'brand_competitor_ads', args: { p_brand_id: 'b1', p_start: '2026-09-10', p_end: '2026-10-07', p_limit: 20, p_offset: 40 } })
      expect(r).toMatchObject({ kind: 'ready', data: { total: 41, page: 3, page_size: 20, data_as_of: '2026-10-07', items: [{ ad_id: 'CR1', times_shown_lower: 1000 }] } })
    })

    it('fără colectare: „Sursă neconectată” cu motivul, nu o listă goală', async () => {
      const { client } = fakeDataClient({ rpc: () => ({ data: { has_set: true, connected: false } }) })
      const r = await createSupabaseCompetition(client).ads(ctx, { page: 1, page_size: 20 })
      expect(r.kind).toBe('not_connected')
      if (r.kind === 'not_connected') {
        expect(r.reason).toMatch(/nu au fost încă colectate/)
        expect(r.reason).not.toMatch(/Transparency/)
      }
    })

    it('un link în afara Ads Transparency Center nu se afișează; un format necunoscut încalcă contractul', async () => {
      const outside = fakeDataClient({ rpc: () => ({ data: { has_set: true, connected: true, total: 1, data_as_of: null, items: [{ ...ad, source_url: 'https://evil.test/x' }] } }) })
      const r = await createSupabaseCompetition(outside.client).ads(ctx, { page: 1, page_size: 20 })
      expect(r.kind === 'ready' && r.data.items[0]!.source_url).toBeNull()
      const bad = fakeDataClient({ rpc: () => ({ data: { has_set: true, connected: true, total: 1, data_as_of: null, items: [{ ...ad, format: 'audio' }] } }) })
      expect((await createSupabaseCompetition(bad.client).ads(ctx, { page: 1, page_size: 20 })).kind).toBe('error')
    })
  })
})
