import { describe, expect, it } from 'vitest'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseBrands } from './brandsProvider'

const NOW = () => new Date('2026-10-08T10:00:00Z')

describe('brands (supabase)', () => {
  it('listează doar brandurile active, fără categorie inventată', async () => {
    const { client, calls } = fakeDataClient({ tables: { brands: [{ id: 'b1', tenant_id: 't1', name: 'Urinal', domain: 'urinal.example', status: 'active' }, { id: 'b2', tenant_id: 't1', name: 'Vechi', domain: null, status: 'archived' }] } })
    const r = await createSupabaseBrands(client, NOW).list()
    expect(r).toEqual({ kind: 'ready', data: [{ id: 'b1', tenant_id: 't1', name: 'Urinal', category: null, domain: 'urinal.example' }] })
    expect(calls[0]?.filters).toContainEqual(['status', 'eq', 'active'])
  })

  it('setul de competitori efectiv: ultima versiune cu effective_from <= azi, membrii etichetați C1…', async () => {
    const { client } = fakeDataClient({
      tables: {
        competitor_sets: [
          { id: 's1', brand_id: 'b1', version: 1, effective_from: '2026-09-01' },
          { id: 's2', brand_id: 'b1', version: 2, effective_from: '2026-10-01' },
          { id: 's3', brand_id: 'b1', version: 3, effective_from: '2026-11-01' },
        ],
        competitor_set_members: [
          { id: 'm1', competitor_set_id: 's2', name: 'Alfa', sort_order: 0 },
          { id: 'm2', competitor_set_id: 's2', name: 'Beta', sort_order: 1 },
          { id: 'm0', competitor_set_id: 's1', name: 'Vechi', sort_order: 0 },
        ],
      },
    })
    const r = await createSupabaseBrands(client, NOW).competitorSet('b1')
    expect(r).toEqual({ kind: 'ready', data: { brand_id: 'b1', version: 2, effective_from: '2026-10-01', competitors: [{ id: 'm1', name: 'Alfa', label: 'C1' }, { id: 'm2', name: 'Beta', label: 'C2' }] } })
  })

  it('fără set în vigoare: eroare explicită, nu un set gol', async () => {
    const { client } = fakeDataClient({ tables: { competitor_sets: [] } })
    expect((await createSupabaseBrands(client, NOW).competitorSet('b1')).kind).toBe('error')
  })

  it('eroare de bază de date → mesaj prietenos', async () => {
    const { client } = fakeDataClient({ errors: { brands: { code: '42501', message: 'permission denied for table brands' } } })
    const r = await createSupabaseBrands(client, NOW).list()
    expect(r).toEqual({ kind: 'error', message: expect.not.stringMatching(/permission|brands/) })
  })
})
