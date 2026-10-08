import { describe, expect, it } from 'vitest'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseConfig, createSupabaseUsers } from './adminProviders'

const T = 't-1'
const membership = (user_id: string, role = 'strategist', revoked_at: string | null = null) => ({ tenant_id: T, user_id, role, revoked_at, created_at: '2026-09-01T09:00:00Z', tenants: { name: 'AdSymphony' } })

describe('users (supabase)', () => {
  it('construiește persoanele din membership și brand_access; fără nume sau email inventate', async () => {
    const { client } = fakeDataClient({
      tables: {
        memberships: [membership('u-1', 'agency_admin'), membership('u-2', 'client_viewer', '2026-10-01T00:00:00Z')],
        brand_access: [
          { tenant_id: T, brand_id: 'b-1', user_id: 'u-2', revoked_at: null },
          { tenant_id: T, brand_id: 'b-2', user_id: 'u-2', revoked_at: '2026-10-02T00:00:00Z' },
        ],
      },
    })
    const r = await createSupabaseUsers(client).people()
    if (r.kind !== 'ready') throw new Error('nu e ready')
    expect(r.data).toHaveLength(2)
    expect(r.data[0]).toMatchObject({ user_id: 'u-1', role: 'agency_admin', organization: 'AdSymphony', membership_active: true, name: null, email: null, brands: [] })
    expect(r.data[1]).toMatchObject({ user_id: 'u-2', membership_active: false, brands: [{ brand_id: 'b-1', active: true }, { brand_id: 'b-2', active: false }] })
  })

  it('un rol necunoscut în răspuns dă eroare, nu o presupunere', async () => {
    const { client } = fakeDataClient({ tables: { memberships: [membership('u-1', 'superuser')], brand_access: [] } })
    expect((await createSupabaseUsers(client).people()).kind).toBe('error')
  })

  it('nu își poate schimba singur rolul, nu își poate revoca singur accesul și nu face nicio scriere', async () => {
    const fake = fakeDataClient({ userId: 'u-1', tables: { memberships: [membership('u-1', 'agency_admin')] } })
    const users = createSupabaseUsers(fake.client)
    expect(await users.setRole(T, 'u-1', 'account')).toEqual({ kind: 'error', message: 'Nu îți poți modifica singur rolul sau accesul.' })
    expect((await users.setMembershipActive(T, 'u-1', false)).kind).toBe('error')
    expect((await users.setBrandAccess(T, 'u-1', 'b-1', false)).kind).toBe('error')
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  it('schimbă rolul și revocă accesul, filtrând pe tenant și utilizator', async () => {
    const fake = fakeDataClient({ userId: 'u-1', tables: { memberships: [membership('u-1', 'agency_admin'), membership('u-2')] } })
    const users = createSupabaseUsers(fake.client)
    expect((await users.setRole(T, 'u-2', 'account')).kind).toBe('ready')
    const upd = fake.calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ role: 'account' })
    expect(upd.filters).toEqual(expect.arrayContaining([['tenant_id', 'eq', T], ['user_id', 'eq', 'u-2']]))
    await users.setMembershipActive(T, 'u-2', false)
    const revoke = fake.calls.filter((c) => c.op === 'update')[1]!
    expect((revoke.payload as { revoked_at: string }).revoked_at).toMatch(/^2\d{3}-/)
  })

  it('acces la brand: rândul existent se restabilește; unul nou se inserează cu granted_by = utilizatorul curent', async () => {
    const fake = fakeDataClient({ userId: 'u-1', tables: { brand_access: [{ tenant_id: T, brand_id: 'b-1', user_id: 'u-2', revoked_at: '2026-10-02T00:00:00Z' }] } })
    const users = createSupabaseUsers(fake.client)
    await users.setBrandAccess(T, 'u-2', 'b-1', true)
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ revoked_at: null })
    await users.setBrandAccess(T, 'u-2', 'b-9', true)
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toEqual({ tenant_id: T, brand_id: 'b-9', user_id: 'u-2', granted_by: 'u-1' })
  })

  it('lipsa dreptului (42501) are mesaj clar, fără detalii de bază de date', async () => {
    const fake = fakeDataClient({ userId: 'u-1', errors: { 'memberships:update': { code: '42501', message: 'new row violates row-level security policy' } } })
    const r = await createSupabaseUsers(fake.client).setRole(T, 'u-2', 'account')
    expect(r).toEqual({ kind: 'error', message: 'Doar administratorii agenției pot modifica accesul.' })
  })

  it('fără sesiune: nu scrie nimic', async () => {
    const fake = fakeDataClient({ userId: null })
    expect((await createSupabaseUsers(fake.client).setRole(T, 'u-2', 'account')).kind).toBe('error')
    expect(fake.calls).toEqual([])
  })
})

describe('config (supabase)', () => {
  const NOW = () => new Date('2026-10-08T10:00:00Z')

  it('versiunile de competitori: cea efectivă e marcată, viitoarele nu; membrii etichetați C1…', async () => {
    const { client } = fakeDataClient({
      tables: {
        competitor_sets: [
          { id: 's1', brand_id: 'b1', version: 1, effective_from: '2026-08-01', note: null, created_at: '2026-07-30T00:00:00Z' },
          { id: 's2', brand_id: 'b1', version: 2, effective_from: '2026-10-01', note: 'Schimbare', created_at: '2026-09-29T00:00:00Z' },
          { id: 's3', brand_id: 'b1', version: 3, effective_from: '2026-12-01', note: null, created_at: '2026-10-05T00:00:00Z' },
        ],
        competitor_set_members: [
          { id: 'm1', brand_id: 'b1', competitor_set_id: 's2', name: 'Alfa', domain: 'alfa.example', sort_order: 0 },
          { id: 'm2', brand_id: 'b1', competitor_set_id: 's2', name: 'Beta', domain: null, sort_order: 1 },
        ],
      },
    })
    const r = await createSupabaseConfig(client, NOW).competitorVersions('b1')
    if (r.kind !== 'ready') throw new Error('nu e ready')
    expect(r.data.map((v) => [v.version, v.current])).toEqual([[3, false], [2, true], [1, false]])
    expect(r.data[1]?.members).toEqual([{ id: 'm1', name: 'Alfa', domain: 'alfa.example', label: 'C1' }, { id: 'm2', name: 'Beta', domain: null, label: 'C2' }])
  })

  it('aliasurile: „Sursă neconectată" cu motiv (nu există tabel)', async () => {
    const { client } = fakeDataClient()
    expect((await createSupabaseConfig(client, NOW).aliases('b1')).kind).toBe('not_connected')
  })

  it('maparea SEOmonitor: ultima versiune în vigoare per grup, fără cele viitoare', async () => {
    const row = (o: Record<string, unknown>) => ({ campaign_id: '1', group_id: '10', version: 1, effective_from: '2026-09-01', mapping_kind: 'brand', brand_id: 'b1', brand_type: 'branded', is_primary_visibility: false, note: null, ...o })
    const { client } = fakeDataClient({ tables: { seomonitor_group_mappings: [row({}), row({ version: 2, effective_from: '2026-10-01', brand_type: 'nonbranded' }), row({ version: 3, effective_from: '2026-12-01' }), row({ group_id: '11', mapping_kind: 'excluded', brand_id: null, brand_type: null })] } })
    const r = await createSupabaseConfig(client, NOW).seomonitorMappings()
    if (r.kind !== 'ready') throw new Error('nu e ready')
    expect(r.data.map((m) => [m.group_id, m.version, m.kind])).toEqual(expect.arrayContaining([['10', 2, 'brand'], ['11', 1, 'excluded']]))
    expect(r.data).toHaveLength(2)
  })
})
