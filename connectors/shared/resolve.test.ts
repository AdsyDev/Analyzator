import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBrands, SlugResolutionError } from './resolve.ts'
import { FakeDb } from './test-helpers.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const T3 = '10000000-0000-0000-0000-000000000003'

function db() {
  return new FakeDb({
    tenants: [
      { id: T1, slug: 'stada', status: 'active' },
      { id: T2, slug: 'alt-client', status: 'active' },
      { id: T3, slug: 'arhivat', status: 'archived' },
    ],
    brands: [
      { id: 'b-1a', tenant_id: T1, slug: 'brand-a', status: 'active' },
      { id: 'b-1b', tenant_id: T1, slug: 'brand-b', status: 'active' },
      { id: 'b-1x', tenant_id: T1, slug: 'brand-vechi', status: 'archived' },
      { id: 'b-2c', tenant_id: T2, slug: 'brand-c', status: 'active' },
      { id: 'b-3a', tenant_id: T3, slug: 'brand-a', status: 'active' },
    ],
  })
}

describe('resolveBrands', () => {
  test('mapează slugurile pe ID-uri, păstrând restul câmpurilor', async () => {
    const out = await resolveBrands(db(), [
      { tenant_slug: 'stada', brand_slug: 'brand-a', token: 't1' },
      { tenant_slug: 'stada', brand_slug: 'brand-b', token: 't2' },
      { tenant_slug: 'alt-client', brand_slug: 'brand-c', token: 't3' },
    ])
    assert.deepEqual(
      out.map((o) => [o.tenant_id, o.brand_id, o.token]),
      [[T1, 'b-1a', 't1'], [T1, 'b-1b', 't2'], [T2, 'b-2c', 't3']],
    )
  })

  test('tenant negăsit: eroare explicită, fără query pe branduri', async () => {
    const d = db()
    await assert.rejects(
      resolveBrands(d, [{ tenant_slug: 'inexistent', brand_slug: 'brand-a' }]),
      (err: unknown) => err instanceof SlugResolutionError && /inexistent/.test(err.message),
    )
    assert.equal(d.log.filter((l) => l.table === 'brands').length, 0)
  })

  test('brand care există doar în alt tenant: oprește rularea (nu scrie în alt brand)', async () => {
    await assert.rejects(
      resolveBrands(db(), [{ tenant_slug: 'stada', brand_slug: 'brand-c' }]),
      (err: unknown) => err instanceof SlugResolutionError && /brand-c/.test(err.message),
    )
  })

  test('un singur slug greșit oprește toată rularea, chiar dacă restul sunt valide', async () => {
    await assert.rejects(
      resolveBrands(db(), [
        { tenant_slug: 'stada', brand_slug: 'brand-a' },
        { tenant_slug: 'stada', brand_slug: 'brand-z' },
      ]),
      SlugResolutionError,
    )
  })

  test('tenant sau brand arhivat: tratat ca negăsit', async () => {
    await assert.rejects(resolveBrands(db(), [{ tenant_slug: 'arhivat', brand_slug: 'brand-a' }]), SlugResolutionError)
    await assert.rejects(resolveBrands(db(), [{ tenant_slug: 'stada', brand_slug: 'brand-vechi' }]), SlugResolutionError)
  })

  test('slug cu caractere de filtru PostgREST: respins înainte de orice query', async () => {
    const d = db()
    await assert.rejects(resolveBrands(d, [{ tenant_slug: 'stada', brand_slug: 'brand-a,brand-c)&or=(id.neq.x' }]))
    await assert.rejects(resolveBrands(d, [{ tenant_slug: 'stada&tenant_id=neq.x', brand_slug: 'brand-a' }]))
    assert.equal(d.log.length, 0)
  })
})
