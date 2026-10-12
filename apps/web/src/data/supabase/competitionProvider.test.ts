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
})
